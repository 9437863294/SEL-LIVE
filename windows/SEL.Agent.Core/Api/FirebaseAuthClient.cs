using System;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Core.Api
{
    /// <summary>The tokens a successful sign-in yields.</summary>
    public sealed class FirebaseSession
    {
        public string IdToken { get; set; }
        public string RefreshToken { get; set; }
        public string LocalId { get; set; }
        public string Email { get; set; }
        public DateTime ExpiresAtUtc { get; set; }

        /// <summary>
        /// True while the token has more than two minutes left.
        /// </summary>
        /// <remarks>
        /// The margin is not arbitrary. A token refreshed at the moment of expiry can still be
        /// rejected: the agent's clock may be a minute fast, the request takes time to reach the
        /// server, and Firebase checks the token against *its* clock. Two minutes covers ordinary
        /// skew on a domain-joined PC and costs one extra refresh an hour.
        /// </remarks>
        public bool IsUsable
        {
            get { return !string.IsNullOrEmpty(IdToken) && ExpiresAtUtc > DateTime.UtcNow.AddMinutes(2); }
        }
    }

    /// <summary>
    /// Signs in to Firebase Authentication over its REST API.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why REST rather than a Firebase SDK.</b> There is no Firebase client SDK for .NET
    /// Framework, and the Admin SDK is emphatically not an option — it authenticates with a
    /// service-account key, and putting one of those inside an executable that ships to four
    /// hundred desks would hand anybody who unzipped it full read and write access to the whole
    /// database. §40 rules it out explicitly and it is worth restating, because "just use the
    /// Admin SDK" is the shortcut that would otherwise get taken here.
    /// </para>
    /// <para>
    /// The Identity Toolkit REST endpoint is the same one the browser SDK calls underneath. It
    /// takes the <i>public</i> Web API key — the value already in
    /// <c>NEXT_PUBLIC_FIREBASE_API_KEY</c>, which is public by design and grants nothing on its
    /// own — and returns the same ID token the web app gets. Every SEL LIVE API route then
    /// verifies that token exactly as it verifies a browser's.
    /// </para>
    /// <para>
    /// <b>The password never touches SEL LIVE's own servers.</b> It goes from the gate straight
    /// to Google, over TLS, and is cleared from memory afterwards. That is a deliberate
    /// alternative to proxying sign-in through <c>/api/windows-agent/login</c>, which would have
    /// been slightly simpler and would have put every employee's password through an
    /// application log's worth of opportunities to be captured.
    /// </para>
    /// <para>
    /// The refresh token is persisted (DPAPI-protected) so the agent survives a restart without
    /// asking again; the ID token is held only in memory, because it expires in an hour and
    /// writing it down buys nothing.
    /// </para>
    /// </remarks>
    public sealed class FirebaseAuthClient
    {
        private const string SignInUrl =
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=";
        private const string RefreshUrl = "https://securetoken.googleapis.com/v1/token?key=";

        private readonly HttpClient _http;
        private readonly string _apiKey;

        public FirebaseAuthClient(string apiKey, HttpClient http)
        {
            if (string.IsNullOrEmpty(apiKey)) throw new ArgumentException("A Firebase Web API key is required.");
            _apiKey = apiKey;
            _http = http ?? throw new ArgumentNullException("http");
        }

        /// <summary>
        /// Exchange an email and password for tokens.
        /// </summary>
        /// <remarks>
        /// The password parameter is a plain string rather than a <c>SecureString</c>, and that is
        /// a considered choice rather than an oversight: it has to be UTF-8 encoded into a request
        /// body regardless, so a SecureString would be marshalled to managed memory one line later
        /// and achieve nothing except the appearance of rigour. What does help is not keeping it —
        /// the caller clears its buffer as soon as this returns.
        /// </remarks>
        public async Task<FirebaseSession> SignInAsync(string email, string password, CancellationToken cancellation)
        {
            string payload = JsonConvert.SerializeObject(new
            {
                email = email,
                password = password,
                returnSecureToken = true
            });

            using (var request = new HttpRequestMessage(HttpMethod.Post, SignInUrl + _apiKey))
            {
                request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await _http.SendAsync(request, cancellation).ConfigureAwait(false))
                {
                    string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!response.IsSuccessStatusCode) throw TranslateError(body, (int)response.StatusCode);

                    JObject parsed = JObject.Parse(body);
                    int expiresIn;
                    int.TryParse((string)parsed["expiresIn"], out expiresIn);
                    return new FirebaseSession
                    {
                        IdToken = (string)parsed["idToken"],
                        RefreshToken = (string)parsed["refreshToken"],
                        LocalId = (string)parsed["localId"],
                        Email = (string)parsed["email"],
                        ExpiresAtUtc = DateTime.UtcNow.AddSeconds(expiresIn > 0 ? expiresIn : 3600)
                    };
                }
            }
        }

        /// <summary>Trade a refresh token for a fresh ID token.</summary>
        public async Task<FirebaseSession> RefreshAsync(string refreshToken, CancellationToken cancellation)
        {
            if (string.IsNullOrEmpty(refreshToken)) throw new ArgumentException("A refresh token is required.");

            var form = new FormUrlEncodedContent(new[]
            {
                new System.Collections.Generic.KeyValuePair<string, string>("grant_type", "refresh_token"),
                new System.Collections.Generic.KeyValuePair<string, string>("refresh_token", refreshToken)
            });

            using (var request = new HttpRequestMessage(HttpMethod.Post, RefreshUrl + _apiKey))
            {
                request.Content = form;
                using (HttpResponseMessage response = await _http.SendAsync(request, cancellation).ConfigureAwait(false))
                {
                    string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!response.IsSuccessStatusCode) throw TranslateError(body, (int)response.StatusCode);

                    JObject parsed = JObject.Parse(body);
                    int expiresIn;
                    int.TryParse((string)parsed["expires_in"], out expiresIn);
                    return new FirebaseSession
                    {
                        IdToken = (string)parsed["id_token"],
                        RefreshToken = (string)parsed["refresh_token"] ?? refreshToken,
                        LocalId = (string)parsed["user_id"],
                        ExpiresAtUtc = DateTime.UtcNow.AddSeconds(expiresIn > 0 ? expiresIn : 3600)
                    };
                }
            }
        }

        /// <summary>
        /// Turn Google's error codes into something to show on a login screen.
        /// </summary>
        /// <remarks>
        /// <c>EMAIL_NOT_FOUND</c> and <c>INVALID_PASSWORD</c> collapse into one message on
        /// purpose. Distinguishing them tells anybody at the keyboard which email addresses exist
        /// in the company — a free directory enumeration from the login screen of a machine that
        /// is, by design, sitting unattended in an office.
        /// </remarks>
        private static Exception TranslateError(string body, int statusCode)
        {
            string code = null;
            try
            {
                JObject parsed = JObject.Parse(body);
                code = (string)parsed["error"]?["message"];
            }
            catch
            {
                // Non-JSON error — usually a proxy's HTML error page. Fall through to the generic
                // message, which is more use than the HTML would be.
            }

            if (code != null)
            {
                if (code.StartsWith("EMAIL_NOT_FOUND") || code.StartsWith("INVALID_PASSWORD") ||
                    code.StartsWith("INVALID_LOGIN_CREDENTIALS"))
                {
                    return new FirebaseAuthException("That email or password is not correct.", code, false);
                }
                if (code.StartsWith("USER_DISABLED"))
                {
                    return new FirebaseAuthException("This account has been disabled. Contact HR.", code, false);
                }
                if (code.StartsWith("TOO_MANY_ATTEMPTS_TRY_LATER"))
                {
                    return new FirebaseAuthException(
                        "Too many sign-in attempts from this computer. Wait a few minutes and try again.", code, true);
                }
                if (code.StartsWith("TOKEN_EXPIRED") || code.StartsWith("INVALID_REFRESH_TOKEN") ||
                    code.StartsWith("USER_NOT_FOUND"))
                {
                    return new FirebaseAuthException("Your saved sign-in has expired. Please sign in again.", code, false);
                }
            }

            bool transient = statusCode == 0 || statusCode >= 500 || statusCode == 429;
            return new FirebaseAuthException(
                transient
                    ? "SEL LIVE could not be reached to verify your sign-in. Check the network and try again."
                    : "Sign-in failed. Please try again.",
                code ?? ("HTTP_" + statusCode),
                transient);
        }
    }

    public sealed class FirebaseAuthException : Exception
    {
        public FirebaseAuthException(string message, string code, bool isTransient)
            : base(message)
        {
            Code = code;
            IsTransient = isTransient;
        }

        public string Code { get; private set; }

        /// <summary>True when the same credentials might work shortly.</summary>
        public bool IsTransient { get; private set; }
    }

    /// <summary>
    /// The refresh token, kept across restarts.
    /// </summary>
    /// <remarks>
    /// Per Windows user rather than per machine — this is a *person's* credential, and on a shared
    /// PC storing it machine-wide would let the next person to sign in to Windows resume the
    /// previous person's SEL LIVE session. So it lives under the user's own LocalApplicationData
    /// and is DPAPI-protected with a distinct purpose string.
    /// </remarks>
    public sealed class RefreshTokenStore
    {
        private readonly string _path;

        public RefreshTokenStore()
        {
            string directory = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SEL LIVE", "Agent");
            System.IO.Directory.CreateDirectory(directory);
            _path = System.IO.Path.Combine(directory, "session.dat");
        }

        public void Save(string refreshToken, string email)
        {
            try
            {
                string payload = JsonConvert.SerializeObject(new { refreshToken, email, savedAt = Contracts.IsoTime.Now() });
                System.IO.File.WriteAllText(_path,
                    DpapiProtector.Protect(payload, DpapiProtector.Purpose.UserSession));
            }
            catch (Exception)
            {
                // Losing the saved session costs one extra sign-in, which is not worth an error
                // dialog in front of somebody who has just successfully signed in.
            }
        }

        public bool TryLoad(out string refreshToken, out string email)
        {
            refreshToken = null;
            email = null;
            try
            {
                if (!System.IO.File.Exists(_path)) return false;
                string plain = DpapiProtector.Unprotect(
                    System.IO.File.ReadAllText(_path), DpapiProtector.Purpose.UserSession);
                if (plain == null) return false;
                JObject parsed = JObject.Parse(plain);
                refreshToken = (string)parsed["refreshToken"];
                email = (string)parsed["email"];
                return !string.IsNullOrEmpty(refreshToken);
            }
            catch
            {
                return false;
            }
        }

        public void Clear()
        {
            try
            {
                if (System.IO.File.Exists(_path)) System.IO.File.Delete(_path);
            }
            catch
            {
                // See Save: a failure here is not worth interrupting a sign-out.
            }
        }
    }
}
