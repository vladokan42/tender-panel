"""Bounded, synchronous website-candidate research; no database writes or LLM.

research(server_selected_lines, server_configured_search_url) -> candidate dicts
for SourcingStore.command(action='research_results', verified=True). The caller
must retain source revisions and enforce current internal-repeat prerequisites.
Only name/characteristics/region leave this process; keys stay local. The URL
argument is server configuration, NEVER request JSON. Only the verified local
OpenSERP DuckDuckGo endpoint is accepted (Yandex/Google currently return 429).
Website/catalogue presence is a candidate, not product fit, stock or delivery.
"""
import http.client
import ipaddress
import json
import queue
import re
import socket
import ssl
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import quote, urlencode, urljoin, urlsplit, urlunsplit

SEARCH_URL = 'http://127.0.0.1:7000/duck/search'
MAX_BYTES = 1024 * 1024
TIMEOUT = 10


class ResearchError(ValueError):
    """Fail closed: the caller must not publish partial results as success."""


class _Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self.titles = [], [], []
        self.hidden = 0
        self.title = False
        self.feed(html)
        self.close()
        self.text = ' '.join(' '.join(self.parts).split())
        self.name = ' '.join(' '.join(self.titles).split())[:300]
        emails = re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', self.text)
        phones = re.findall(r'(?<!\w)\+?\d[\d ()\-.]{7,}\d(?!\w)', self.text)
        self.email = next((email for email in emails if len(email) <= 320), '')
        self.phone = next((phone for phone in phones if 10 <= len(re.sub(r'\D', '', phone)) <= 15), '')[:100]
        # Preserve real contact context even when a long catalogue precedes it.
        context = [self.text[max(0, self.text.index(value) - 80):self.text.index(value) + len(value) + 80]
                   for value in (self.email, self.phone) if value and self.text.index(value) >= 3000]
        self.excerpt = (self.text[:3000] + ' '.join(context))[:4000] if context else self.text[:4000]

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'template'):
            self.hidden += 1
        if self.hidden:
            return
        if tag == 'title':
            self.title = True
        if tag == 'a':
            href = dict(attrs).get('href') or ''
            if href.lower().startswith(('mailto:', 'tel:')):
                self.parts.append(href.split(':', 1)[1].split('?', 1)[0])
            else:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'template'):
            self.hidden = max(0, self.hidden - 1)
        if tag == 'title':
            self.title = False

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)
            if self.title:
                self.titles.append(data)


def _domain(url):
    try:
        return (urlsplit(url).hostname or '').encode('idna').decode('ascii').lower().removeprefix('www.').rstrip('.')
    except (ValueError, UnicodeError):
        raise ResearchError('Invalid website domain in search results') from None


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ResearchError('Research network timeout (10s)')
    return remaining


def _arm_deadline(connection, deadline):
    connection.connect()
    sock = connection.sock

    def abort():
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    # A socket timeout alone permits endless trickled headers. Shut down the
    # pinned socket at the absolute deadline, including during getresponse().
    timer = threading.Timer(_remaining(deadline), abort)
    timer.daemon = True
    timer.start()
    return timer


def _read_body(response, connection, deadline):
    if response.getheader('Content-Encoding', 'identity').lower() not in ('identity', ''):
        raise ResearchError('Compressed responses are not accepted')
    size = response.getheader('Content-Length')
    if size is not None and (len(size) > 7 or not size.isdecimal() or int(size) > MAX_BYTES):
        raise ResearchError('Response exceeds 1 MiB or invalid Content-Length')
    body = bytearray()
    while True:
        remaining = _remaining(deadline)
        sock = connection.sock or getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
        if sock is not None:
            sock.settimeout(remaining)
        chunk = response.read1(min(65536, MAX_BYTES + 1 - len(body)))
        _remaining(deadline)
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise ResearchError('Response exceeds 1 MiB')
        if not chunk:
            if size is not None and len(body) != int(size):
                raise ResearchError('Truncated response body')
            return bytes(body)


def _search(spec, search_url):
    endpoint = urlsplit(search_url)
    query = ' '.join(value for value in spec.values() if value)
    path = endpoint.path + '?' + urlencode(dict(text=query, limit=5, features='false', extract=0))
    connection = http.client.HTTPConnection(endpoint.hostname, 7000, timeout=TIMEOUT)
    deadline = time.monotonic() + TIMEOUT
    timer = None
    try:
        timer = _arm_deadline(connection, deadline)
        connection.request('GET', path, headers={'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        if connection.sock:
            connection.sock.settimeout(_remaining(deadline))
        response = connection.getresponse()
        if response.status != 200:
            raise ResearchError(f'OpenSERP HTTP {response.status}')
        if 'application/json' not in response.getheader('Content-Type', '').lower():
            raise ResearchError('OpenSERP did not return JSON')
        body = _read_body(response, connection, deadline)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError, RecursionError):
            raise ResearchError('OpenSERP returned invalid JSON') from None
        if (not isinstance(payload, dict) or not isinstance(payload.get('results'), list)
                or not isinstance(payload.get('meta'), dict) or not isinstance(payload.get('query'), dict)):
            raise ResearchError('OpenSERP returned an invalid search envelope')
        if payload.get('error') or payload['meta'].get('engines_failed'):
            raise ResearchError('OpenSERP engine failed')
        if (payload['query'].get('text') != query
                or payload['query'].get('engines_requested') != ['duckduckgo']):
            raise ResearchError('OpenSERP query/engine mismatch')
        if len(payload['results']) > 5 or any(not isinstance(hit, dict) or not isinstance(hit.get('url'), str)
                                             for hit in payload['results']):
            raise ResearchError('OpenSERP returned invalid results')
        return [hit for hit in payload['results'] if hit.get('type') == 'organic']
    except (OSError, http.client.HTTPException) as exc:
        raise ResearchError(f'OpenSERP network failure: {type(exc).__name__}') from None
    finally:
        if timer:
            timer.cancel()
        connection.close()


def _public(ip):
    address = ipaddress.ip_address(ip)
    if not address.is_global or address.is_multicast or address.is_reserved or address.is_unspecified:
        raise ResearchError('Website DNS/IP must be public global unicast only')
    # Reject IPv4-embedded IPv6 mechanisms, including NAT64/6to4 transition ranges.
    if address.version == 6 and (address.ipv4_mapped or address.sixtofour or address.teredo
                                 or address in ipaddress.ip_network('64:ff9b::/96')):
        raise ResearchError('IPv4-embedded IPv6 website addresses are not accepted')
    return str(address)


def _resolve(host, deadline):
    # getaddrinfo has no timeout API. A daemon bounds waiting without blocking
    # interpreter shutdown if the system resolver wedges; never use its late result.
    result = queue.Queue(maxsize=1)

    def resolve():
        try:
            result.put(socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM))
        except OSError as exc:
            result.put(exc)

    threading.Thread(target=resolve, daemon=True).start()
    try:
        rows = result.get(timeout=_remaining(deadline))
    except queue.Empty:
        raise ResearchError('Website DNS timeout (10s)') from None
    if isinstance(rows, OSError):
        raise ResearchError('Website DNS resolution failed') from None
    if not rows:
        raise ResearchError('Website DNS has no public addresses')
    addresses = [_public(row[4][0]) for row in rows]
    return addresses[0]


def _target(url, deadline, same_host=None):
    if (not isinstance(url, str) or not url or len(url) > 2000 or '\\' in url
            or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in url)
            or re.search(r'%0[0-9a-f]|%1[0-9a-f]|%7f', url, re.I)):
        raise ResearchError('Invalid website URL')
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or '@' in parsed.netloc
                or parsed.port not in (None, 443) or '%' in parsed.hostname):
            raise ValueError
        host = parsed.hostname.encode('idna').decode('ascii').lower().rstrip('.')
        if same_host is not None and host != same_host:
            raise ResearchError('Contacts redirects must stay on the same host')
        try:
            ip = _public(host)
        except ValueError as exc:
            if isinstance(exc, ResearchError):
                raise
            if ('.' not in host or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                                      for label in host.split('.'))):
                raise ValueError
            ip = _resolve(host, deadline)
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError('Invalid HTTPS website URL (public host, port 443, no userinfo)') from None
    return parsed, host, ip


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, ip, deadline):
        super().__init__(host, 443, timeout=_remaining(deadline), context=ssl.create_default_context())
        self.ip, self.deadline = ip, deadline

    def connect(self):
        # Never pass the hostname to create_connection: DNS was validated once.
        sock = socket.socket(socket.AF_INET6 if ':' in self.ip else socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.settimeout(_remaining(self.deadline))
            sock.connect((self.ip, 443))
            sock.settimeout(_remaining(self.deadline))
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def _fetch_html(url, *, same_host=None):
    deadline = time.monotonic() + TIMEOUT
    for redirect in range(4):
        parsed, host, ip = _target(url, deadline, same_host)
        connection = _PinnedHTTPS(host, ip, deadline)
        timer = None
        try:
            timer = _arm_deadline(connection, deadline)
            path = quote(parsed.path or '/', safe='/%:@-._~')
            if parsed.query:
                path += '?' + quote(parsed.query, safe='=&%/:?@-._~')
            connection.request('GET', path, headers={'Accept': 'text/html', 'Accept-Encoding': 'identity',
                                                    'User-Agent': 'SupplierDiscoveryDemo/1.0'})
            if connection.sock:
                connection.sock.settimeout(_remaining(deadline))
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if redirect == 3 or not location:
                    raise ResearchError('Website redirect limit (3) or missing Location')
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ResearchError(f'Website HTTP {response.status}')
            content_type = response.getheader('Content-Type', '')
            if content_type.split(';', 1)[0].strip().lower() not in ('text/html', 'application/xhtml+xml'):
                raise ResearchError('Website did not return HTML')
            body = _read_body(response, connection, deadline)
            charset = re.search(r'charset\s*=\s*["\']?([\w-]+)', content_type, re.I)
            if not charset:
                charset = re.search(r'charset\s*=\s*["\']?([\w-]+)', body[:4096].decode('ascii', 'ignore'), re.I)
            try:
                html = body.decode(charset[1] if charset else 'utf-8', errors='replace')
            except LookupError:
                raise ResearchError('Website HTML has an unsupported charset') from None
            # Store the actual fetched address, not the search snippet or a guessed root.
            return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, '')), html
        except (OSError, http.client.HTTPException) as exc:
            raise ResearchError(f'Website network/TLS failure: {type(exc).__name__}') from None
        finally:
            if timer:
                timer.cancel()
            connection.close()


def research(lines: list, search_url: str, warnings: list | None = None) -> list:
    """Up to ten exact lines, one query/spec, at most five domain candidates.

    Missing contacts are empty strings; delivery is always 'unknown'. Any
    invalid input, search, DNS, TLS, HTTP or parse failure raises ResearchError.
    Successful searches with no organic results return []. No retries/fallback.
    """
    if search_url not in (SEARCH_URL, SEARCH_URL.replace('127.0.0.1', '10.0.0.4'), 'http://search-adapter.example.invalid:7000/duck/search'):
        raise ResearchError('Use the configured local OpenSERP /duck/search endpoint')
    if not isinstance(lines, list) or len(lines) > 10:
        raise ResearchError('Research accepts at most 10 lines')
    specs = {}
    for row in lines:
        if not isinstance(row, dict) or not isinstance(row.get('key'), str) or not row['key']:
            raise ResearchError('Each research line needs its local key')
        # Explicit outbound allowlist: never stringify the row or structured source.
        spec = {field: row.get(field, '') for field in ('name', 'characteristics', 'region')}
        if any(not isinstance(value, str) or len(value) > 4000 or any(ord(c) < 32 and c not in '\n\r\t' for c in value)
               for value in spec.values()) or not spec['name'].strip():
            raise ResearchError('Research fields must be plain text, with a product name (max 4000 each)')
        signature = tuple(' '.join(value.split()) for value in spec.values())
        if sum(map(len, signature)) > 4000:
            raise ResearchError('Research specification exceeds 4000 characters')
        if signature not in specs:
            specs[signature] = (dict(zip(spec, signature)), [])
        if row['key'] not in specs[signature][1]:
            specs[signature][1].append(row['key'])
    candidates, aliases = {}, {}
    fetched = 0
    for spec, keys in specs.values():
        for hit in _search(spec, search_url):
            url = hit['url']
            domain = _domain(url)
            domain = aliases.get(domain, domain)
            if domain in candidates:
                candidates[domain]['line_keys'] = list(dict.fromkeys(candidates[domain]['line_keys'] + keys))
                continue
            if fetched == 5:
                continue
            fetched += 1
            try:
                final_url, html = _fetch_html(url)
                aliases[domain] = _domain(final_url)
                domain = _domain(final_url)
                if domain in candidates:
                    candidates[domain]['line_keys'] = list(dict.fromkeys(candidates[domain]['line_keys'] + keys))
                    continue
                page = _Page(html)
                if not page.text:
                    raise ResearchError('Website has no readable HTML text')
                checked = datetime.now(timezone.utc).isoformat()
                sources = [dict(url=final_url, text=page.excerpt, checked_at=checked)]
                email, phone = page.email, page.phone
                if not email or not phone:
                    for href in page.links:
                        if not re.search(r'contact|kontakt|контакт', href, re.I):
                            continue
                        try:
                            contact_url = urljoin(final_url, href)
                            contact_host = urlsplit(contact_url).hostname
                        except ValueError:
                            raise ResearchError('Malformed website contact link') from None
                        if contact_host == urlsplit(final_url).hostname and contact_url != final_url:
                            contact_url, contact_html = _fetch_html(contact_url, same_host=urlsplit(final_url).hostname)
                            contact = _Page(contact_html)
                            if not contact.text:
                                raise ResearchError('Contacts page has no readable HTML text')
                            sources.append(dict(url=contact_url, text=contact.excerpt,
                                                checked_at=datetime.now(timezone.utc).isoformat()))
                            email, phone = email or contact.email, phone or contact.phone
                            break
                candidates[domain] = dict(name=page.name or urlsplit(final_url).hostname,
                    site=final_url, email=email, phone=phone, delivery='unknown',
                    line_keys=list(keys), sources=sources)
            except ResearchError as exc:
                if warnings is None:
                    raise
                warnings.append(str(exc))
    return list(candidates.values())
