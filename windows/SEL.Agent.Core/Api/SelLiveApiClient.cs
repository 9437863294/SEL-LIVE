using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;

namespace Sel.Agent.Core.Api
{
    /// <summary>
    /// The agent's whole vocabulary: the nine routes under <c>/api/windows-agent</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// There is no Firestore client anywhere in this codebase, and that is the design rather than
    /// an omission. §41 requires the agent to go through controlled APIs so that every write is
    /// validated, rate-limitable and attributable; the practical consequence is that a decompiled
    /// agent reveals a list of URLs and nothing that can be used to read another employee's data.
    /// </para>
    /// <para>
    /// <b>Two headers on every call.</b> <c>X-SEL-Device-Id</c> and <c>X-SEL-Device-Secret</c>
    /// prove the machine; the Firebase ID token in the body proves the person. Both are required
    /// for anything that touches a session, which is what makes a stolen laptop useless without a
    /// password and a stolen password useless on an unenrolled PC.
    /// </para>
    /// <para>
    /// <b>Retries are the caller's business, not this class's.</b> A transient failure on a
    /// heartbeat should be forgotten — the next beat is ninety seconds away and carries the same
    /// information. A transient failure on an activity batch must *not* be forgotten, because
    /// those spans are the record; the queue keeps them and retries on its own schedule. Baking a
    /// retry loop in here would make the first case chatty and the second case lossy, so the
    /// client reports faithfully and lets each caller decide.
    /// </para>
    /// </remarks>
    public sealed class SelLiveApiClient : IDisposable
    {
        private const string DeviceIdHeader = "X-SEL-Device-Id";
        private const string DeviceSecretHeader = "X-SEL-Device-Secret";
        private const string AgentVersionHeader = "X-SEL-Agent-Version";
        private const string IdTokenHeader = "X-SEL-Id-Token";

        private readonly HttpClient _http;
        private readonly bool _ownsHttpClient;
        private readonly string _agentVersion;

        public SelLiveApiClient(string baseUrl, string agentVersion)
            : this(baseUrl, agentVersion, null)
        {
        }

        public SelLiveApiClient(string baseUrl, string agentVersion, HttpClient http)
        {
            if (string.IsNullOrEmpty(baseUrl)) throw new ArgumentException("An API base URL is required.");
            TlsBootstrap.Configure();

            BaseUrl = baseUrl.TrimEnd('/');
            _agentVersion = agentVersion ?? "0.0.0";

            if (http != null)
            {
                _http = http;
                _ownsHttpClient = false;
            }
            else
            {
                var handler = new HttpClientHandler();
                // Corporate proxies are the norm in a head office; using the system settings means
                // an administrator configures the proxy once in Windows rather than twice.
                if (handler.SupportsAutomaticDecompression)
                {
                    handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                }
                handler.UseProxy = true;
                handler.Proxy = WebRequest.GetSystemWebProxy();
                handler.UseDefaultCredentials = true;

                _http = new HttpClient(handler);
                _ownsHttpClient = true;
            }

            // Generous enough for a site office on a congested link, short enough that a hung
            // request cannot block the agent's loop for minutes.
            _http.Timeout = TimeSpan.FromSeconds(30);
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("SEL-LIVE-Agent/" + _agentVersion);
        }

        public string BaseUrl { get; private set; }

        /// <summary>Device credential, set once the PC has enrolled.</summary>
        public string DeviceId { get; set; }

        /// <summary>Device secret, held in memory only; the disk copy stays DPAPI-protected.</summary>
        public string DeviceSecret { get; set; }

        /// <summary>The HttpClient, exposed so <see cref="FirebaseAuthClient"/> can share the pool.</summary>
        public HttpClient Http { get { return _http; } }

        /* ── Routes ──────────────────────────────────────────────────────────────────────── */

        public Task<DeviceRegisterResponse> RegisterDeviceAsync(DeviceRegisterRequest request, CancellationToken cancellation)
        {
            // The one route with no device credential — the PC does not have one yet.
            return SendAsync<DeviceRegisterResponse>(HttpMethod.Post, "/api/windows-agent/device/register",
                request, false, null, cancellation);
        }

        public Task<AgentLoginResponse> LoginAsync(AgentLoginRequest request, CancellationToken cancellation)
        {
            return SendAsync<AgentLoginResponse>(HttpMethod.Post, "/api/windows-agent/login",
                request, true, null, cancellation);
        }

        public Task<HeartbeatResponse> HeartbeatAsync(HeartbeatRequest request, CancellationToken cancellation)
        {
            return SendAsync<HeartbeatResponse>(HttpMethod.Post, "/api/windows-agent/heartbeat",
                request, true, null, cancellation);
        }

        public Task<ActivityBatchResponse> SendActivityAsync(ActivityBatchRequest request, CancellationToken cancellation)
        {
            return SendAsync<ActivityBatchResponse>(HttpMethod.Post, "/api/windows-agent/activity/batch",
                request, true, null, cancellation);
        }

        public Task<object> LogoutAsync(SessionLogoutRequest request, CancellationToken cancellation)
        {
            return SendAsync<object>(HttpMethod.Post, "/api/windows-agent/session/logout",
                request, true, null, cancellation);
        }

        public Task<NotificationListResponse> FetchNotificationsAsync(string idToken, CancellationToken cancellation)
        {
            return SendAsync<NotificationListResponse>(HttpMethod.Get, "/api/windows-agent/notifications",
                null, true, idToken, cancellation);
        }

        public Task<object> AcknowledgeNotificationAsync(NotificationAckRequest request, CancellationToken cancellation)
        {
            return SendAsync<object>(HttpMethod.Post, "/api/windows-agent/notifications/ack",
                request, true, null, cancellation);
        }

        public Task<PolicyResponse> FetchPolicyAsync(string idToken, CancellationToken cancellation)
        {
            return SendAsync<PolicyResponse>(HttpMethod.Get, "/api/windows-agent/policy",
                null, true, idToken, cancellation);
        }

        public Task<VersionCheckResponse> CheckVersionAsync(CancellationToken cancellation)
        {
            return SendAsync<VersionCheckResponse>(HttpMethod.Get, "/api/windows-agent/version",
                null, true, null, cancellation);
        }

        /// <summary>
        /// A Firebase custom token so the agent's embedded ERP window opens already signed in.
        /// </summary>
        /// <remarks>
        /// The token is for the caller's own user and nobody else's — the server takes the uid
        /// from the verified ID token, never from anything this client sends.
        /// </remarks>
        public Task<ErpSessionResponse> CreateErpSessionAsync(string idToken, CancellationToken cancellation)
        {
            return SendAsync<ErpSessionResponse>(HttpMethod.Post, "/api/windows-agent/erp-session",
                new { idToken }, true, null, cancellation);
        }

        /// <summary>
        /// Ask SEL LIVE whether this administrator may close the agent on this computer.
        /// </summary>
        /// <remarks>
        /// <para>
        /// <paramref name="approverIdToken"/> belongs to the administrator standing at the
        /// keyboard, not to whoever is signed in to the agent — those are different people by
        /// definition, which is why it travels as an <c>Authorization</c> bearer rather than in
        /// the usual agent-user header.
        /// </para>
        /// <para>
        /// The server decides, and records who decided. Evaluating the permission here instead
        /// would put the answer on the machine being argued with, and would leave no trail
        /// explaining why a PC stopped reporting.
        /// </para>
        /// </remarks>
        public Task<ExitApprovalResponse> RequestExitApprovalAsync(
            string approverIdToken, string reason, CancellationToken cancellation)
        {
            return SendAsync<ExitApprovalResponse>(
                HttpMethod.Post,
                "/api/windows-agent/exit-approval",
                new { reason },
                true,
                null,
                approverIdToken,
                cancellation);
        }

        /// <summary>
        /// Turn an employee ID into the email address Firebase knows the person by.
        /// </summary>
        /// <remarks>
        /// §5's sign-in form offers "Employee ID / Email", and Firebase only understands the
        /// latter — so something has to bridge them. Doing it server-side keeps the mapping where
        /// the employee master already is, rather than shipping a directory to every PC.
        /// <para>
        /// It takes the device credential and no password, which is the right trade: an
        /// unenrolled machine learns nothing, and an enrolled one is already a company PC where
        /// the staff directory is not a secret. It deliberately does not say whether an account
        /// exists for an <i>email</i> — only employee IDs resolve — so it cannot be used to
        /// enumerate addresses.
        /// </para>
        /// </remarks>
        public Task<ResolveLoginResponse> ResolveLoginAsync(string employeeIdentifier, CancellationToken cancellation)
        {
            return SendAsync<ResolveLoginResponse>(HttpMethod.Post, "/api/windows-agent/resolve-login",
                new { identifier = employeeIdentifier }, true, null, cancellation);
        }

        /* ── Transport ───────────────────────────────────────────────────────────────────── */

        private Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            object payload,
            bool requireDevice,
            string idTokenHeader,
            CancellationToken cancellation)
        {
            return SendAsync<T>(method, path, payload, requireDevice, idTokenHeader, null, cancellation);
        }

        /// <summary>
        /// The full request, with an optional <c>Authorization</c> bearer token.
        /// </summary>
        /// <remarks>
        /// <para>
        /// Two different token headers, deliberately. <c>X-SEL-Id-Token</c> carries the token of
        /// whoever is signed in to the agent, on routes that act on their behalf.
        /// <c>Authorization: Bearer</c> carries a *different* person's token — presently only the
        /// administrator approving an exit — and is the header every browser-facing route in this
        /// application already reads, so those routes need no special handling for the agent.
        /// </para>
        /// <para>
        /// Kept as an overload so the eleven callers that never need a bearer are not each made
        /// to pass a null for it.
        /// </para>
        /// </remarks>
        private async Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            object payload,
            bool requireDevice,
            string idTokenHeader,
            string bearerToken,
            CancellationToken cancellation)
        {
            if (requireDevice && (string.IsNullOrEmpty(DeviceId) || string.IsNullOrEmpty(DeviceSecret)))
            {
                throw new SelApiException("This computer is not enrolled.", 401, "DEVICE_UNKNOWN");
            }

            using (var request = new HttpRequestMessage(method, BaseUrl + path))
            {
                if (requireDevice)
                {
                    request.Headers.TryAddWithoutValidation(DeviceIdHeader, DeviceId);
                    request.Headers.TryAddWithoutValidation(DeviceSecretHeader, DeviceSecret);
                }
                request.Headers.TryAddWithoutValidation(AgentVersionHeader, _agentVersion);
                if (!string.IsNullOrEmpty(idTokenHeader))
                {
                    // GET routes have no body, so the user token travels in a header instead.
                    request.Headers.TryAddWithoutValidation(IdTokenHeader, idTokenHeader);
                }
                if (!string.IsNullOrEmpty(bearerToken))
                {
                    request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + bearerToken);
                }

                if (payload != null)
                {
                    string json = JsonConvert.SerializeObject(payload, SerializerSettings);
                    request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                }

                HttpResponseMessage response;
                try
                {
                    response = await _http.SendAsync(request, cancellation).ConfigureAwait(false);
                }
                catch (TaskCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    // HttpClient reports its own timeout as a cancellation, which is
                    // indistinguishable from a caller's cancel unless the token is checked.
                    // Status 0 marks it transient so the queue retries rather than discards.
                    throw new SelApiException("The request to SEL LIVE timed out.", 0, "BAD_REQUEST");
                }
                catch (HttpRequestException error)
                {
                    throw new SelApiException(DescribeNetworkFailure(error), 0, "BAD_REQUEST");
                }

                using (response)
                {
                    string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                    if (!response.IsSuccessStatusCode)
                    {
                        ApiErrorBody error = null;
                        try
                        {
                            error = JsonConvert.DeserializeObject<ApiErrorBody>(body);
                        }
                        catch
                        {
                            // An HTML error page from a proxy, most likely. The status code is
                            // still meaningful even when the body is not.
                        }
                        throw new SelApiException(
                            error != null && !string.IsNullOrEmpty(error.Error)
                                ? error.Error
                                : "SEL LIVE returned " + (int)response.StatusCode + ".",
                            (int)response.StatusCode,
                            error != null ? error.Code : null);
                    }

                    if (typeof(T) == typeof(object) || string.IsNullOrEmpty(body)) return default(T);
                    return JsonConvert.DeserializeObject<T>(body);
                }
            }
        }

        /// <summary>
        /// Say something useful about a network failure.
        /// </summary>
        /// <remarks>
        /// The default message for a TLS failure on Windows 7 is "An error occurred while sending
        /// the request", which sends an administrator looking at the firewall for an afternoon.
        /// Naming TLS as the likely cause on the one OS where it usually is turns that into a
        /// five-minute fix.
        /// </remarks>
        private static string DescribeNetworkFailure(Exception error)
        {
            Exception inner = error;
            while (inner.InnerException != null) inner = inner.InnerException;

            var authFailure = inner as System.Security.Authentication.AuthenticationException;
            if (authFailure != null || inner is System.ComponentModel.Win32Exception)
            {
                if (OsCompatibility.Current.IsWindows7)
                {
                    return "Secure connection to SEL LIVE failed. On Windows 7 this is almost always TLS 1.2 "
                         + "not being enabled — run the agent's prerequisite check. (" + inner.Message + ")";
                }
                return "Secure connection to SEL LIVE failed: " + inner.Message;
            }

            return "SEL LIVE could not be reached: " + inner.Message;
        }

        private static readonly JsonSerializerSettings SerializerSettings = new JsonSerializerSettings
        {
            // Omitting nulls keeps the batch payload small — on a slow site link, a few hundred
            // spans' worth of `"windowTitle": null` is bandwidth spent saying nothing.
            NullValueHandling = NullValueHandling.Ignore
        };

        public void Dispose()
        {
            if (_ownsHttpClient) _http.Dispose();
        }
    }

    /// <summary>The policy route's response, including §52's disclosure for the tray panel.</summary>
    public sealed class PolicyResponse
    {
        [JsonProperty("policy")] public ResolvedAgentPolicy Policy { get; set; }
        [JsonProperty("device")] public PolicyDeviceInfo Device { get; set; }
        [JsonProperty("disclosure")] public MonitoringDisclosure Disclosure { get; set; }
    }

    public sealed class PolicyDeviceInfo
    {
        [JsonProperty("deviceId")] public string DeviceId { get; set; }
        [JsonProperty("deviceName")] public string DeviceName { get; set; }
        [JsonProperty("status")] public string Status { get; set; }
        [JsonProperty("departmentName")] public string DepartmentName { get; set; }
        [JsonProperty("assignedLocation")] public string AssignedLocation { get; set; }
    }

    /// <summary>The embedded ERP window's single-sign-on token.</summary>
    public sealed class ErpSessionResponse
    {
        [JsonProperty("customToken")] public string CustomToken { get; set; }
        [JsonProperty("userId")] public string UserId { get; set; }
        [JsonProperty("userName")] public string UserName { get; set; }
        [JsonProperty("email")] public string Email { get; set; }
    }

    /// <summary>Whether a SEL LIVE administrator authorised closing the agent.</summary>
    public sealed class ExitApprovalResponse
    {
        [JsonProperty("approved")] public bool Approved { get; set; }
        [JsonProperty("approvedBy")] public string ApprovedBy { get; set; }
        [JsonProperty("approvedByName")] public string ApprovedByName { get; set; }
    }

    /// <summary>The employee-ID lookup's answer. <c>Email</c> is null when nothing matched.</summary>
    public sealed class ResolveLoginResponse
    {
        [JsonProperty("email")] public string Email { get; set; }
        [JsonProperty("displayName")] public string DisplayName { get; set; }
    }

    public sealed class MonitoringDisclosure
    {
        [JsonProperty("statement")] public string Statement { get; set; }
        [JsonProperty("collected")] public List<string> Collected { get; set; }
        [JsonProperty("neverCollected")] public List<string> NeverCollected { get; set; }
        [JsonProperty("optional")] public List<string> Optional { get; set; }
    }
}
