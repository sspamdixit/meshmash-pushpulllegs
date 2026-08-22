import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  Command,
  Crosshair,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  KeyRound,
  Layers3,
  MapPin,
  Menu,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  Route,
  Switch,
  Router as WouterRouter,
  useLocation,
} from 'wouter';

const queryClient = new QueryClient();

const DEFAULT_API_URL = 'https://meshmash-pushpulllegs.onrender.com/api/packets/pull?limit=1000';
const DEFAULT_POLL = '30';

type Severity = 'critical' | 'high' | 'normal' | 'unknown';
type RawPacket = {
  id?: string | number;
  sender_id?: string;
  message_type?: string;
  latitude?: number | string;
  longitude?: number | string;
  payload_json?: unknown;
  hops?: number;
  created_at?: string;
};
type MeshPayload = {
  requestId?: string;
  originDeviceId?: string;
  category?: string;
  priority?: string | number;
  createdAtMillis?: number | string;
  requester?: { name?: string; contact?: string; [key: string]: unknown } | string;
  location?: { latitude?: number; longitude?: number; label?: string; [key: string]: unknown };
  payloadEncoding?: string;
  payload?: unknown;
  relayMetadata?: { [key: string]: unknown };
  [key: string]: unknown;
};
type RelayRequest = RawPacket & {
  id: string;
  payload: MeshPayload;
  severity: Severity;
  category: string;
  subject: string;
  origin: string;
};
type PullResponse = { status?: string; count?: number; data?: RawPacket[] };

function readPayload(value: unknown): MeshPayload {
  if (value && typeof value === 'object') return value as MeshPayload;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as MeshPayload : { payload: parsed };
    } catch {
      return { payload: value };
    }
  }
  return {};
}

function getSeverity(value: unknown): Severity {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('critical') || normalized === 'p0' || normalized === '1') return 'critical';
  if (normalized.includes('high') || normalized === 'urgent' || normalized === 'p1' || normalized === '2') return 'high';
  if (normalized.includes('normal') || normalized.includes('medium') || normalized === 'p2' || normalized === '3') return 'normal';
  return 'unknown';
}

function normalizePacket(packet: RawPacket): RelayRequest {
  const payload = readPayload(packet.payload_json);
  const severity = getSeverity(payload.priority);
  const requester = typeof payload.requester === 'string'
    ? payload.requester
    : payload.requester?.name || payload.requester?.contact || 'Unidentified requester';
  return {
    ...packet,
    id: String(packet.id ?? payload.requestId ?? crypto.randomUUID()),
    payload,
    severity,
    category: String(payload.category || packet.message_type || 'mesh request').replace(/[_-]/g, ' '),
    subject: typeof payload.payload === 'string' ? payload.payload : `${String(payload.category || packet.message_type || 'Incoming request')} from ${requester}`,
    origin: String(payload.originDeviceId || packet.sender_id || 'Unknown device'),
  };
}

function formatRelativeTime(dateValue?: string | number) {
  if (!dateValue) return 'Time unavailable';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  const delta = Math.max(0, Date.now() - date.getTime());
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDate(dateValue?: string | number) {
  if (!dateValue) return 'Not provided';
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? 'Not provided' : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function priorityLabel(severity: Severity) {
  return severity === 'unknown' ? 'UNSET' : severity.toUpperCase();
}

function severityClass(severity: Severity) {
  return {
    critical: 'bg-[#fce4df] text-[#a53e30] border-[#f5c0b7]',
    high: 'bg-[#fff0c9] text-[#895700] border-[#efd18a]',
    normal: 'bg-[#dcefe9] text-[#176a58] border-[#b7ddd2]',
    unknown: 'bg-[#ecebe5] text-[#68706f] border-[#d8d7d0]',
  }[severity];
}

function SkeletonRows() {
  return <div className="space-y-2" aria-label="Loading requests">
    {[1, 2, 3, 4, 5].map((item) => (
      <div key={item} className="h-[92px] animate-pulse rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <div className="mb-3 h-3 w-24 rounded bg-[hsl(var(--muted))]" />
        <div className="h-4 w-3/4 rounded bg-[hsl(var(--muted))]" />
        <div className="mt-3 h-2.5 w-1/2 rounded bg-[hsl(var(--muted))]" />
      </div>
    ))}
  </div>;
}

function Home() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('sos-relay-api-url') || DEFAULT_API_URL);
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('sos-relay-api-key') || '');
  const [draftUrl, setDraftUrl] = useState(apiUrl);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [pollSeconds, setPollSeconds] = useState(DEFAULT_POLL);
  const [polling, setPolling] = useState(true);
  const [showConfig, setShowConfig] = useState(!apiKey);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [requests, setRequests] = useState<RelayRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!apiKey.trim()) {
      setShowConfig(true);
      setHasLoaded(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(apiUrl, {
        headers: { 'x-api-key': apiKey.trim(), Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'The API key was rejected. Check the session key and try again.'
          : `Relay API returned ${response.status}.`);
      }
      const body = await response.json() as PullResponse;
      if (!Array.isArray(body.data)) throw new Error('The relay returned an unexpected response shape.');
      const normalized = body.data.map(normalizePacket);
      setRequests(normalized);
      setLastUpdated(new Date());
      setHasLoaded(true);
      setSelectedId((current) => current && normalized.some((request) => request.id === current) ? current : normalized[0]?.id || null);
    } catch (requestError) {
      setHasLoaded(true);
      setError(requestError instanceof Error ? requestError.message : 'Could not reach the relay API.');
    } finally {
      setLoading(false);
    }
  }, [apiKey, apiUrl]);

  useEffect(() => {
    if (!apiKey) return;
    void loadRequests();
  }, [apiKey, loadRequests]);

  useEffect(() => {
    if (!polling || !apiKey) return;
    const timer = window.setInterval(() => void loadRequests(), Number(pollSeconds) * 1000);
    return () => window.clearInterval(timer);
  }, [apiKey, loadRequests, polling, pollSeconds]);

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesSeverity = severityFilter === 'all' || request.severity === severityFilter;
      const haystack = [request.id, request.origin, request.category, request.subject, request.sender_id].join(' ').toLowerCase();
      return matchesSeverity && (!query || haystack.includes(query));
    });
  }, [requests, search, severityFilter]);

  const selected = requests.find((request) => request.id === selectedId) || null;
  const summary = useMemo(() => ({
    total: requests.length,
    critical: requests.filter((request) => request.severity === 'critical').length,
    high: requests.filter((request) => request.severity === 'high').length,
    located: requests.filter((request) => request.latitude !== undefined || request.payload.location).length,
  }), [requests]);

  const saveConfig = () => {
    const cleanUrl = draftUrl.trim() || DEFAULT_API_URL;
    setApiUrl(cleanUrl);
    setApiKey(draftKey.trim());
    localStorage.setItem('sos-relay-api-url', cleanUrl);
    if (draftKey.trim()) sessionStorage.setItem('sos-relay-api-key', draftKey.trim());
    else sessionStorage.removeItem('sos-relay-api-key');
    setShowConfig(false);
  };

  const clearSessionKey = () => {
    setDraftKey('');
    setApiKey('');
    sessionStorage.removeItem('sos-relay-api-key');
    setRequests([]);
    setError('');
    setShowConfig(true);
  };

  const copyRequestId = async () => {
    if (!selected) return;
    await navigator.clipboard?.writeText(selected.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="flex min-h-[100dvh]">
        <aside className={`${mobileNav ? 'fixed inset-0 z-40 flex' : 'hidden'} w-[250px] shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex`}>
          {mobileNav && <button aria-label="Close navigation" data-testid="button-close-navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 bg-[#111a2a]/45 md:hidden" />}
          <div className="relative z-10 flex h-full w-[250px] flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex items-center gap-3 px-6 py-6">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-[11px] bg-sidebar-primary text-sidebar-primary-foreground">
                <Radio size={19} strokeWidth={2.4} />
                <span className="pulse-dot absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#e1604d]" />
              </div>
              <div>
                <div className="display text-[15px] font-extrabold tracking-[-.03em]">SOS Relay</div>
                <div className="mono mt-0.5 text-[9px] uppercase tracking-[.16em] text-sidebar-foreground/50">Operations / 01</div>
              </div>
            </div>
            <div className="px-4">
              <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Control room</div>
              <button data-testid="button-nav-requests" className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-3 text-left text-sm font-semibold text-sidebar-accent-foreground">
                <Activity size={17} className="text-sidebar-primary" />
                Incoming requests
                <span className="mono ml-auto rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] text-sidebar-primary">{summary.total}</span>
              </button>
            </div>
            <div className="mt-8 px-7">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Relay health</div>
              <div className="space-y-4">
                <HealthLine icon={<Server size={14} />} label="API endpoint" value={apiKey ? 'Connected' : 'Awaiting key'} ok={Boolean(apiKey && !error)} />
                <HealthLine icon={<Wifi size={14} />} label="Polling" value={polling ? `${pollSeconds}s interval` : 'Paused'} ok={polling} />
                <HealthLine icon={<Database size={14} />} label="Packets in view" value={String(summary.total)} ok />
              </div>
            </div>
            <div className="mt-auto border-t border-sidebar-border p-5">
              <button data-testid="button-open-settings" onClick={() => { setDraftUrl(apiUrl); setDraftKey(apiKey); setShowConfig(true); }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <Settings2 size={16} />
                Session settings
                <SlidersHorizontal size={14} className="ml-auto opacity-50" />
              </button>
              <div className="mt-4 flex items-center gap-2 px-2 text-[10px] text-sidebar-foreground/35">
                <ShieldCheck size={13} />
                Key stays in this browser session
              </div>
            </div>
          </div>
        </aside>

        <main className="mesh-grid min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border bg-background/90 px-5 py-4 backdrop-blur-md md:px-9">
            <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button data-testid="button-open-navigation" aria-label="Open navigation" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden"><Menu size={19} /></button>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${apiKey && !error ? 'bg-[#3f9b7f]' : 'bg-[#d89b34]'}`} />
                    <span className="mono text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">{apiKey && !error ? 'Relay online' : 'Configuration needed'}</span>
                  </div>
                  <h1 className="display mt-1 text-xl font-extrabold md:text-2xl">Incoming requests</h1>
                </div>
              </div>
              <div className="flex items-center gap-2 md:gap-4">
                <div className="hidden text-right sm:block">
                  <div className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Last sync</div>
                  <div className="mt-0.5 text-xs font-semibold">{lastUpdated ? formatRelativeTime(lastUpdated.getTime()) : 'Not synced'}</div>
                </div>
                <button data-testid="button-refresh-requests" aria-label="Refresh requests" onClick={() => void loadRequests()} disabled={loading || !apiKey} className="group flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold transition-colors hover:border-primary/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : 'transition-transform group-hover:rotate-45'} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button data-testid="button-toggle-config" onClick={() => { setDraftUrl(apiUrl); setDraftKey(apiKey); setShowConfig((open) => !open); }} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-px">
                  <KeyRound size={14} />
                  <span className="hidden sm:inline">API session</span>
                </button>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] px-5 py-6 md:px-9 md:py-9">
            <div className="fade-up grid gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
              <section>
                <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                  <div>
                    <div className="mono mb-2 text-[10px] font-medium uppercase tracking-[.16em] text-primary">Mesh perimeter / north star</div>
                    <h2 className="display text-[clamp(1.9rem,4vw,3.2rem)] font-extrabold leading-[.95]">A clear view<br /><span className="text-muted-foreground/65">when it matters.</span></h2>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground md:pb-1">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-primary shadow-sm"><Crosshair size={15} /></span>
                    Live packet stream
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
                  <SummaryCard label="Total packets" value={summary.total} hint="in current pull" icon={<Layers3 size={16} />} accent="text-primary" />
                  <SummaryCard label="Critical" value={summary.critical} hint="needs immediate action" icon={<AlertCircle size={16} />} accent="text-[#b64938]" />
                  <SummaryCard label="High priority" value={summary.high} hint="review next" icon={<AlertTriangle size={16} />} accent="text-[#a36d0c]" />
                  <SummaryCard label="With location" value={summary.located} hint="coordinates available" icon={<MapPin size={16} />} accent="text-[#257a68]" />
                </div>

                <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-card/80">
                  <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between md:px-5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-[#3f9b7f]" />
                      <h3 className="text-sm font-extrabold">Request queue</h3>
                      <span className="mono rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{filteredRequests.length} shown</span>
                    </div>
                    <div className="flex gap-2">
                      <label className="relative min-w-0 flex-1 md:w-[220px]">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input data-testid="input-search-requests" aria-label="Search requests" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search packets..." className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20" />
                      </label>
                      <label className="relative">
                        <Filter size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <select data-testid="select-severity-filter" aria-label="Filter by priority" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="h-9 appearance-none rounded-lg border border-border bg-background py-0 pl-8 pr-8 text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                          <option value="all">All priority</option>
                          <option value="critical">Critical</option>
                          <option value="high">High</option>
                          <option value="normal">Normal</option>
                          <option value="unknown">Unset</option>
                        </select>
                        <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </label>
                    </div>
                  </div>

                  <div className="p-2.5 md:p-3">
                    {loading && !hasLoaded ? <SkeletonRows /> : error ? (
                      <div className="flex min-h-[290px] flex-col items-center justify-center rounded-xl border border-[#f1c2ba] bg-[#fff7f4] p-8 text-center">
                        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#fce4df] text-[#b64938]"><AlertCircle size={20} /></div>
                        <h3 className="text-sm font-extrabold text-[#8f3328]">The relay is not responding</h3>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-[#a65b50]">{error}</p>
                        <button data-testid="button-retry-requests" onClick={() => void loadRequests()} className="mt-5 flex items-center gap-2 rounded-lg bg-[#b64938] px-3.5 py-2 text-xs font-bold text-[#fff7f4] transition-transform hover:-translate-y-px"><RefreshCw size={13} /> Try again</button>
                      </div>
                    ) : !apiKey ? (
                      <EmptyState icon={<KeyRound size={21} />} title="Connect the relay to begin" body="Add your session API key to pull the latest mesh packets. It never leaves this browser session." action={() => setShowConfig(true)} actionLabel="Configure API session" />
                    ) : filteredRequests.length === 0 ? (
                      <EmptyState icon={<Radio size={21} />} title={requests.length ? 'No packets match' : 'The queue is quiet'} body={requests.length ? 'Try a different search or priority filter.' : 'No incoming mesh requests were returned from the relay.'} action={requests.length ? () => { setSearch(''); setSeverityFilter('all'); } : () => void loadRequests()} actionLabel={requests.length ? 'Clear filters' : 'Pull again'} />
                    ) : (
                      <div className="space-y-2">
                        {filteredRequests.map((request, index) => <RequestRow key={request.id} request={request} selected={request.id === selectedId} onSelect={() => setSelectedId(request.id)} index={index} />)}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <aside className="space-y-4">
                {showConfig ? (
                  <ConfigPanel draftUrl={draftUrl} draftKey={draftKey} setDraftUrl={setDraftUrl} setDraftKey={setDraftKey} saveConfig={saveConfig} clearSessionKey={clearSessionKey} onClose={() => setShowConfig(false)} />
                ) : selected ? (
                  <DetailPanel request={selected} onClose={() => setSelectedId(null)} onCopy={copyRequestId} copied={copied} />
                ) : (
                  <div className="panel-shadow flex min-h-[395px] flex-col justify-between rounded-2xl border border-border bg-card/80 p-6">
                    <div>
                      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Terminal size={18} /></div>
                      <div className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Inspector</div>
                      <h3 className="display mt-2 text-2xl font-extrabold">Select a request</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a packet from the queue to inspect its relay path, requester details, location, and raw payload.</p>
                    </div>
                    <div className="border-t border-border pt-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2"><Command size={13} /> Keyboard friendly queue</div>
                      <p className="mt-2 leading-5">Use search to jump to a device, category, or request ID.</p>
                    </div>
                  </div>
                )}
                <div className="rounded-2xl border border-[#d8d7d0] bg-[#eeece4]/70 p-5">
                  <div className="flex items-center gap-2 text-xs font-extrabold"><Gauge size={15} className="text-primary" /> Pull cadence</div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{polling ? 'Automatic refresh is on' : 'Automatic refresh is paused'}</span>
                    <button data-testid="button-toggle-polling" role="switch" aria-checked={polling} onClick={() => setPolling((value) => !value)} className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${polling ? 'bg-primary' : 'bg-[#c9c8c0]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-background transition-transform ${polling ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                  </div>
                  <label className="mt-4 flex items-center justify-between border-t border-[#d8d7d0] pt-3 text-xs">
                    <span className="text-muted-foreground">Refresh every</span>
                    <select data-testid="select-polling-interval" aria-label="Refresh interval" value={pollSeconds} onChange={(event) => setPollSeconds(event.target.value)} className="rounded-md border border-[#d0cfc7] bg-background px-2 py-1 text-xs font-bold outline-none focus:border-primary">
                      <option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="300">5 minutes</option>
                    </select>
                  </label>
                </div>
              </aside>
            </div>
            <footer className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-[10px] text-muted-foreground/70 md:flex-row md:items-center md:justify-between">
              <span className="mono uppercase tracking-[.12em]">SOS Relay / secure operations console</span>
              <span className="flex items-center gap-1.5"><ArrowDownToLine size={12} /> Pull endpoint · {apiUrl.replace(/^https?:\/\//, '').split('/api')[0]}</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function HealthLine({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok: boolean }) {
  return <div className="flex items-center gap-2.5 text-xs">
    <span className="text-sidebar-foreground/45">{icon}</span>
    <span className="text-sidebar-foreground/65">{label}</span>
    <span className="mono ml-auto flex items-center gap-1.5 text-[10px] text-sidebar-foreground/45"><i className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-[#6fc2a6]' : 'bg-[#d89b34]'}`} />{value}</span>
  </div>;
}

function SummaryCard({ label, value, hint, icon, accent }: { label: string; value: number; hint: string; icon: ReactNode; accent: string }) {
  return <div data-testid={`summary-${label.toLowerCase().replaceAll(' ', '-')}`} className="rounded-xl border border-border bg-card/75 p-4 transition-transform hover:-translate-y-0.5">
    <div className={`mb-4 flex items-center justify-between ${accent}`}><span className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">{label}</span>{icon}</div>
    <div className="display text-3xl font-extrabold leading-none">{value}</div>
    <div className="mt-2 text-[10px] text-muted-foreground">{hint}</div>
  </div>;
}

function RequestRow({ request, selected, onSelect, index }: { request: RelayRequest; selected: boolean; onSelect: () => void; index: number }) {
  return <button data-testid={`row-request-${request.id}`} onClick={onSelect} className={`fade-up stagger-${Math.min(index + 1, 4)} group flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-sm md:items-center md:gap-4 md:p-4 ${selected ? 'border-primary/55 bg-[#fffbef] shadow-sm' : 'border-transparent bg-background/60 hover:border-border hover:bg-card'}`}>
    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg md:mt-0 ${request.severity === 'critical' ? 'bg-[#fce4df] text-[#b64938]' : request.severity === 'high' ? 'bg-[#fff0c9] text-[#a36d0c]' : 'bg-[#dcefe9] text-[#257a68]'}`}><Zap size={16} fill="currentColor" /></div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.08em] ${severityClass(request.severity)}`}>{priorityLabel(request.severity)}</span>
        <span className="text-[11px] font-bold capitalize text-muted-foreground">{request.category}</span>
        <span className="mono ml-auto text-[10px] text-muted-foreground/60">{formatRelativeTime(request.created_at)}</span>
      </div>
      <div data-testid={`text-request-subject-${request.id}`} className="mt-2 truncate text-sm font-extrabold capitalize text-foreground">{request.subject}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="mono flex items-center gap-1"><Radio size={11} />{request.origin}</span>
        <span className="flex items-center gap-1"><MapPin size={11} />{request.latitude !== undefined ? `${request.latitude}, ${request.longitude}` : request.payload.location ? 'Payload location' : 'No coordinates'}</span>
        <span className="flex items-center gap-1"><Layers3 size={11} />{request.hops ?? 0} hops</span>
      </div>
    </div>
    <ChevronDown size={16} className="-rotate-90 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
  </button>;
}

function EmptyState({ icon, title, body, action, actionLabel }: { icon: ReactNode; title: string; body: string; action: () => void; actionLabel: string }) {
  return <div className="flex min-h-[290px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/45 p-8 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0c9] text-[#a36d0c]">{icon}</div>
    <h3 className="text-sm font-extrabold">{title}</h3>
    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p>
    <button data-testid={`button-${actionLabel.toLowerCase().replaceAll(' ', '-')}`} onClick={action} className="mt-5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-px">{actionLabel}</button>
  </div>;
}

function ConfigPanel({ draftUrl, draftKey, setDraftUrl, setDraftKey, saveConfig, clearSessionKey, onClose }: { draftUrl: string; draftKey: string; setDraftUrl: (value: string) => void; setDraftKey: (value: string) => void; saveConfig: () => void; clearSessionKey: () => void; onClose: () => void }) {
  return <div className="panel-shadow rounded-2xl border border-border bg-card/95 p-5 md:p-6">
    <div className="flex items-start justify-between">
      <div>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0c9] text-[#a36d0c]"><KeyRound size={18} /></div>
        <div className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Session access</div>
        <h3 className="display mt-1 text-2xl font-extrabold">Connect the relay</h3>
      </div>
      <button data-testid="button-close-config" aria-label="Close session settings" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
    </div>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">Your key is used only for requests from this tab. It is never written to app code or persistent storage.</p>
    <div className="mt-6 space-y-4">
      <label className="block"><span className="mb-1.5 block text-xs font-bold">Pull API URL</span><input data-testid="input-api-url" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} spellCheck={false} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-bold">Session API key</span><input data-testid="input-api-key" type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} autoComplete="off" placeholder="Paste your x-api-key value" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
    </div>
    <div className="mt-5 flex gap-2">
      <button data-testid="button-save-config" onClick={saveConfig} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-px"><Check size={14} /> Save & pull</button>
      <button data-testid="button-clear-key" onClick={clearSessionKey} disabled={!draftKey} className="rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground hover:bg-muted disabled:opacity-40">Clear</button>
    </div>
    <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[10px] leading-4 text-muted-foreground"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#257a68]" /> Keys are held in sessionStorage and disappear when this browser session ends.</div>
  </div>;
}

function DetailPanel({ request, onClose, onCopy, copied }: { request: RelayRequest; onClose: () => void; onCopy: () => void; copied: boolean }) {
  const location = request.payload.location;
  const requester = request.payload.requester;
  return <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-card/95">
    <div className="border-b border-border bg-[#222d40] p-5 text-[#f8f2e7]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold tracking-[.08em] ${severityClass(request.severity)}`}>{priorityLabel(request.severity)}</span>
          <span className="text-[10px] font-semibold capitalize text-[#f8f2e7]/60">{request.category}</span>
        </div>
        <button data-testid="button-close-detail" aria-label="Close request detail" onClick={onClose} className="rounded-lg p-1 text-[#f8f2e7]/60 hover:bg-[#f8f2e7]/10 hover:text-[#f8f2e7]"><X size={16} /></button>
      </div>
      <h3 className="mt-5 text-base font-extrabold leading-6">{request.subject}</h3>
      <div className="mono mt-2 flex items-center gap-1.5 text-[10px] text-[#f8f2e7]/55"><span className="truncate">{request.id}</span><button data-testid="button-copy-request-id" aria-label="Copy request ID" onClick={onCopy} className="rounded p-1 hover:bg-[#f8f2e7]/10">{copied ? <Check size={12} /> : <Clipboard size={12} />}</button></div>
    </div>
    <div className="space-y-5 p-5">
      <DetailSection title="Relay signal">
        <DetailLine label="Received" value={formatDate(request.created_at)} icon={<Clock3 size={13} />} />
        <DetailLine label="Origin device" value={request.origin} icon={<Radio size={13} />} mono />
        <DetailLine label="Hops traversed" value={String(request.hops ?? 0)} icon={<Layers3 size={13} />} />
      </DetailSection>
      <DetailSection title="Requester">
        <DetailLine label="Identity" value={typeof requester === 'string' ? requester : requester?.name || 'Not provided'} />
        <DetailLine label="Contact" value={typeof requester === 'object' ? String(requester?.contact || 'Not provided') : 'Not provided'} />
      </DetailSection>
      <DetailSection title="Location">
        <DetailLine label="Coordinates" value={request.latitude !== undefined ? `${request.latitude}, ${request.longitude}` : location ? `${location.latitude ?? '—'}, ${location.longitude ?? '—'}` : 'Not provided'} icon={<MapPin size={13} />} mono />
        <DetailLine label="Label" value={String(location?.label || 'No location label')} />
      </DetailSection>
      <DetailSection title="Payload">
        <pre data-testid={`text-payload-${request.id}`} className="max-h-[180px] overflow-auto rounded-lg bg-[#222d40] p-3 text-[10px] leading-5 text-[#d9e4df]">{JSON.stringify(request.payload, null, 2)}</pre>
      </DetailSection>
    </div>
    <div className="flex items-center gap-2 border-t border-border bg-muted/45 px-5 py-3 text-[10px] text-muted-foreground"><ExternalLink size={12} /> Request detail is read-only · sourced from pull response</div>
  </div>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h4 className="mono mb-2 text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">{title}</h4><div className="space-y-2">{children}</div></section>;
}

function DetailLine({ label, value, icon, mono }: { label: string; value: string; icon?: ReactNode; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3 text-xs"><span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span><span className={`max-w-[62%] break-words text-right font-semibold ${mono ? 'mono text-[10px]' : ''}`}>{value}</span></div>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
