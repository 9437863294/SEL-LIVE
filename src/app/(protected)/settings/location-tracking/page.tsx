'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  History,
  Loader2,
  LocateFixed,
  LockKeyhole,
  MailCheck,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const ACCESS_TOKEN_KEY = 'sel_location_tracking_otp_token';
const ACCESS_EXPIRY_KEY = 'sel_location_tracking_otp_expires';

const INTERVAL_OPTIONS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '60 minutes' },
];

type LocationRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'Active' | 'Inactive';
  photoURL?: string;
  enabled: boolean;
  intervalSeconds: number;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    platform: string | null;
    lastFetchRequestId: string | null;
    updatedAtIso: string | null;
  } | null;
};

type LocationHistoryRecord = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  platform: string | null;
  capturedAtIso: string | null;
  latestSnapshot?: boolean;
};

async function authorizedRequest(path: string, init: RequestInit = {}, otpToken?: string) {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Your sign-in session is unavailable. Please sign in again.');
  const idToken = await firebaseUser.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(otpToken ? { 'X-Location-OTP-Token': otpToken } : {}),
      ...(init.headers || {}),
    },
  });
}

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || 'Request failed.'));
  return data;
}

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase() || '?';

const formatCapturedAt = (value: string | null) => {
  if (!value) return 'Never captured';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
};

export default function LocationTrackingSettingsPage() {
  const { user } = useAuth();
  const { can, isLoading: permissionLoading } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Settings.Location Tracking');
  const canEdit = can('Edit', 'Settings.Location Tracking');

  const [accessToken, setAccessToken] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [personalPassword, setPersonalPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [search, setSearch] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [historyUser, setHistoryUser] = useState<LocationRow | null>(null);
  const [historyRows, setHistoryRows] = useState<LocationHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const clearAccess = useCallback(() => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_EXPIRY_KEY);
    setAccessToken('');
    setPersonalPassword('');
    setRows([]);
    setHistoryUser(null);
    setHistoryRows([]);
  }, []);

  const loadRows = useCallback(async (token: string) => {
    setLoadingRows(true);
    try {
      const response = await authorizedRequest('/api/location-tracking/settings', {}, token);
      if (response.status === 401) {
        clearAccess();
        throw new Error('Email verification expired. Request a new code.');
      }
      const data = await responseData(response);
      const users = Array.isArray(data.users) ? data.users as LocationRow[] : [];
      setRows(users);
      return users;
    } finally {
      setLoadingRows(false);
    }
  }, [clearAccess]);

  useEffect(() => {
    if (!canView || permissionLoading) return;
    const storedToken = sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
    const expiry = Number(sessionStorage.getItem(ACCESS_EXPIRY_KEY) || 0);
    if (!storedToken || expiry <= Date.now()) {
      clearAccess();
      return;
    }
    setAccessToken(storedToken);
    void loadRows(storedToken).catch((error) => {
      toast({ title: 'Unable to open settings', description: error.message, variant: 'destructive' });
    });
  }, [canView, clearAccess, loadRows, permissionLoading, toast]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const requestOtp = async () => {
    setOtpBusy(true);
    try {
      const data = await responseData(await authorizedRequest('/api/location-tracking/otp/request', { method: 'POST' }));
      setChallengeId(String(data.challengeId));
      setMaskedEmail(String(data.maskedEmail));
      setOtp('');
      setPersonalPassword('');
      setOtpSent(true);
      setResendSeconds(60);
      toast({ title: 'Verification code sent', description: `Check ${data.maskedEmail}.` });
    } catch (error) {
      toast({ title: 'Code not sent', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6 || !challengeId || !personalPassword) return;
    setOtpBusy(true);
    try {
      const data = await responseData(await authorizedRequest('/api/location-tracking/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, otp, personalPassword }),
      }));
      const token = String(data.accessToken || '');
      const expiresAtMs = Number(data.expiresAtMs || 0);
      sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
      sessionStorage.setItem(ACCESS_EXPIRY_KEY, String(expiresAtMs));
      setAccessToken(token);
      setPersonalPassword('');
      setOtpSent(false);
      await loadRows(token);
      toast({ title: 'Access verified', description: 'Location settings are unlocked for 15 minutes.' });
    } catch (error) {
      toast({ title: 'Verification failed', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setOtpBusy(false);
    }
  };

  const updateSetting = async (row: LocationRow, changes: Partial<Pick<LocationRow, 'enabled' | 'intervalSeconds'>>) => {
    if (!accessToken || !canEdit || savingIds.has(row.id)) return;
    const next = { ...row, ...changes };
    setSavingIds((current) => new Set(current).add(row.id));
    setRows((current) => current.map((item) => item.id === row.id ? next : item));
    try {
      await responseData(await authorizedRequest('/api/location-tracking/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          userId: row.id,
          enabled: next.enabled,
          intervalSeconds: next.intervalSeconds,
        }),
      }, accessToken));
      toast({
        title: next.enabled ? 'Location capture enabled' : 'Location capture disabled',
        description: `${row.name} · ${INTERVAL_OPTIONS.find((option) => option.value === next.intervalSeconds)?.label || `${next.intervalSeconds}s`}`,
      });
    } catch (error) {
      setRows((current) => current.map((item) => item.id === row.id ? row : item));
      if (error instanceof Error && /expired|verification/i.test(error.message)) clearAccess();
      toast({ title: 'Setting not saved', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setSavingIds((current) => {
        const nextIds = new Set(current);
        nextIds.delete(row.id);
        return nextIds;
      });
    }
  };

  const openHistory = async (row: LocationRow) => {
    if (!accessToken) return;
    setHistoryUser(row);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const response = await authorizedRequest(
        `/api/location-tracking/history?userId=${encodeURIComponent(row.id)}&limit=500`,
        {},
        accessToken
      );
      if (response.status === 401) {
        clearAccess();
        throw new Error('Email verification expired. Request a new code.');
      }
      const data = await responseData(response);
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      toast({
        title: 'History not loaded',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchCurrentLocation = async (row: LocationRow) => {
    if (!accessToken || !canEdit || !row.enabled || fetchingIds.has(row.id)) return;
    setFetchingIds((current) => new Set(current).add(row.id));
    try {
      const data = await responseData(await authorizedRequest('/api/location-tracking/settings', {
        method: 'PATCH',
        body: JSON.stringify({ userId: row.id, action: 'fetch-current' }),
      }, accessToken));
      const fetchRequestId = String(data?.request?.fetchRequestId || '');
      toast({
        title: 'Current location requested',
        description: `${row.name}’s device is fetching a fresh GPS point.`,
      });

      await new Promise((resolve) => window.setTimeout(resolve, 4_000));
      const refreshedRows = await loadRows(accessToken);
      const refreshedUser = refreshedRows?.find((item) => item.id === row.id);
      if (fetchRequestId && refreshedUser?.location?.lastFetchRequestId === fetchRequestId) {
        toast({
          title: 'Current location received',
          description: `${row.name}’s latest coordinates are now available.`,
        });
      } else {
        toast({
          title: 'Request is waiting',
          description: 'The user must reopen the app if Android Force Stop is active or background permission was removed.',
        });
      }
    } catch (error) {
      if (error instanceof Error && /expired|verification/i.test(error.message)) clearAccess();
      toast({
        title: 'Location request failed',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setFetchingIds((current) => {
        const nextIds = new Set(current);
        nextIds.delete(row.id);
        return nextIds;
      });
    }
  };

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${row.name} ${row.email} ${row.role}`.toLowerCase().includes(query));
  }, [rows, search]);

  const enabledCount = rows.filter((row) => row.enabled).length;
  const capturedCount = rows.filter((row) => row.location).length;

  if (permissionLoading) return <LocationPageSkeleton />;
  if (!canView) return <AccessDenied />;
  if (!accessToken) {
    return (
      <OtpGate
        email={user?.email || ''}
        maskedEmail={maskedEmail}
        otp={otp}
        personalPassword={personalPassword}
        otpSent={otpSent}
        busy={otpBusy}
        resendSeconds={resendSeconds}
        onOtpChange={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
        onPersonalPasswordChange={setPersonalPassword}
        onRequest={() => void requestOtp()}
        onVerify={() => void verifyOtp()}
      />
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><LocateFixed className="h-5 w-5" /></div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Location Tracking</h1>
              <p className="text-sm text-muted-foreground">Choose who shares location and how often it is captured.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadRows(accessToken)} disabled={loadingRows}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingRows ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="ghost" onClick={clearAccess}><LockKeyhole className="mr-2 h-4 w-4" /> Lock</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Users} label="Total users" value={rows.length} />
        <Metric icon={MapPin} label="Capture enabled" value={enabledCount} />
        <Metric icon={LocateFixed} label="Locations received" value={capturedCount} />
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>User capture settings</CardTitle>
            <CardDescription>
              Android continues after normal app dismissal with the required ongoing location notification.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRows ? <RowsSkeleton /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Capture interval</TableHead>
                  <TableHead>Last location</TableHead>
                  <TableHead>Current location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const saving = savingIds.has(row.id);
                  const fetching = fetchingIds.has(row.id);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => void openHistory(row)}
                          className="group flex w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Open location history for ${row.name}`}
                        >
                          <Avatar className="h-9 w-9"><AvatarImage src={row.photoURL} alt={row.name} /><AvatarFallback>{initials(row.name)}</AvatarFallback></Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-semibold group-hover:text-primary group-hover:underline">{row.name || 'Unnamed user'}</p>
                            <p className="truncate text-xs text-muted-foreground">{row.role || row.email}</p>
                          </div>
                          {row.status === 'Inactive' && <Badge variant="secondary">Inactive</Badge>}
                          <History className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.enabled}
                            disabled={!canEdit || saving}
                            onCheckedChange={(enabled) => void updateSetting(row, { enabled })}
                            aria-label={`Require location from ${row.name}`}
                          />
                          <span className="text-xs text-muted-foreground">{row.enabled ? 'Yes' : 'No'}</span>
                          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={String(row.intervalSeconds)}
                          disabled={!canEdit || saving}
                          onValueChange={(value) => void updateSetting(row, { intervalSeconds: Number(value) })}
                        >
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>{INTERVAL_OPTIONS.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {row.location ? (
                          <div className="space-y-1">
                            <a
                              href={`https://www.google.com/maps?q=${row.location.latitude},${row.location.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                            >
                              {row.location.latitude.toFixed(5)}, {row.location.longitude.toFixed(5)} <ExternalLink className="h-3 w-3" />
                            </a>
                            <p className="text-xs text-muted-foreground">{formatCapturedAt(row.location.updatedAtIso)}</p>
                          </div>
                        ) : <span className="text-sm text-muted-foreground">Never captured</span>}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canEdit || !row.enabled || fetching}
                          onClick={() => void fetchCurrentLocation(row)}
                          title={row.enabled ? `Fetch current location for ${row.name}` : 'Enable Required first'}
                        >
                          {fetching
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            : <LocateFixed className="mr-2 h-4 w-4" />}
                          {fetching ? 'Fetching' : 'Fetch now'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!filteredRows.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No matching users found.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LocationHistoryDialog
        user={historyUser}
        records={historyRows}
        loading={historyLoading}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryUser(null);
            setHistoryRows([]);
          }
        }}
      />

      {!canEdit && <p className="text-center text-xs text-muted-foreground">Your role has view-only access. “Location Tracking → Edit” is required to change settings.</p>}
    </div>
  );
}

function LocationHistoryDialog({
  user,
  records,
  loading,
  onOpenChange,
}: {
  user: LocationRow | null;
  records: LocationHistoryRecord[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="h-[min(760px,92vh)] p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            {user?.name || 'User'} · Location history
          </DialogTitle>
          <DialogDescription>
            Captured according to the configured interval, including Android background-service updates.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <RowsSkeleton />
          ) : records.length ? (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Captured at</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Speed</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium">{formatCapturedAt(record.capturedAtIso)}</p>
                        {record.latestSnapshot && <Badge variant="secondary">Latest snapshot</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>{record.accuracy == null ? '—' : `${Math.round(record.accuracy)} m`}</TableCell>
                    <TableCell>{record.speed == null ? '—' : `${(record.speed * 3.6).toFixed(1)} km/h`}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{record.platform || 'Unknown'}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
              <MapPin className="h-9 w-9 text-muted-foreground/50" />
              <p className="mt-3 font-semibold">No location history yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Enable location capture for this user. New timestamped points will appear here as the app records them.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OtpGate({
  email,
  maskedEmail,
  otp,
  personalPassword,
  otpSent,
  busy,
  resendSeconds,
  onOtpChange,
  onPersonalPasswordChange,
  onRequest,
  onVerify,
}: {
  email: string;
  maskedEmail: string;
  otp: string;
  personalPassword: string;
  otpSent: boolean;
  busy: boolean;
  resendSeconds: number;
  onOtpChange: (value: string) => void;
  onPersonalPasswordChange: (value: string) => void;
  onRequest: () => void;
  onVerify: () => void;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md border-emerald-200/70 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldCheck className="h-7 w-7" /></div>
          <CardTitle className="mt-3">Additional verification required</CardTitle>
          <CardDescription>This page controls sensitive employee location settings. Enter the email OTP and personal password to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!otpSent ? (
            <>
              <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Verification email</p>
                <p className="mt-1 text-muted-foreground">{email || 'Your registered account email'}</p>
              </div>
              <Button className="w-full" onClick={onRequest} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailCheck className="mr-2 h-4 w-4" />} Send OTP
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="location-settings-otp">6-digit code sent to {maskedEmail}</Label>
                <Input
                  id="location-settings-otp"
                  value={otp}
                  onChange={(event) => onOtpChange(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="h-12 text-center text-xl font-bold tracking-[0.45em]"
                  onKeyDown={(event) => { if (event.key === 'Enter') onVerify(); }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-settings-password">Personal password</Label>
                <Input
                  id="location-settings-password"
                  type="password"
                  value={personalPassword}
                  onChange={(event) => onPersonalPasswordChange(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter personal password"
                  onKeyDown={(event) => { if (event.key === 'Enter') onVerify(); }}
                />
              </div>
              <Button className="w-full" onClick={onVerify} disabled={busy || otp.length !== 6 || !personalPassword}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify and open
              </Button>
              <Button variant="ghost" className="w-full" onClick={onRequest} disabled={busy || resendSeconds > 0}>
                {resendSeconds > 0 ? `Send again in ${resendSeconds}s` : 'Send a new code'}
              </Button>
            </>
          )}
          <p className="text-center text-xs text-muted-foreground">Access remains unlocked for 15 minutes in this browser tab.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div><div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}

function AccessDenied() {
  return <div className="flex min-h-[calc(100dvh-8rem)] items-center justify-center p-6"><Card className="max-w-md text-center"><CardHeader><ShieldAlert className="mx-auto h-10 w-10 text-destructive" /><CardTitle>Access denied</CardTitle><CardDescription>Your role needs “Settings → Location Tracking → View” permission to open this page.</CardDescription></CardHeader></Card></div>;
}

function LocationPageSkeleton() {
  return <div className="space-y-4 p-6"><Skeleton className="h-12 w-72" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-96" /></div>;
}

function RowsSkeleton() {
  return <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>;
}
