using System;
using System.Collections.Generic;
using System.Data.SQLite;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Sel.Agent.Core.Contracts;
using Sel.Agent.Core.Platform;
using Sel.Agent.Core.Security;

namespace Sel.Agent.Core.Storage
{
    /// <summary>
    /// The durable span queue (§27).
    /// </summary>
    /// <remarks>
    /// <para>
    /// The agent keeps recording when the network is down and syncs when it returns. This is
    /// where the recording goes in the meantime, and it is the difference between a site office
    /// losing an afternoon to a broken link and losing nothing.
    /// </para>
    ///
    /// <para><b>Encryption: DPAPI per row, not an encrypted database file.</b></para>
    /// <para>
    /// §27 asks for encrypted SQLite. The obvious readings are SQLCipher or SQLite's commercial
    /// SEE extension; both were rejected, and the reasoning matters because "we used plain
    /// SQLite" would otherwise look like a corner cut.
    /// </para>
    /// <para>
    /// SQLCipher means shipping a native library per architecture and keeping it patched across
    /// a fleet that includes Windows 7 — and, more awkwardly, it needs a passphrase, which has to
    /// live somewhere on the same machine. Deriving that passphrase from DPAPI and then handing
    /// it to a native library gets exactly the protection DPAPI already gives, with a native
    /// dependency and a key that exists in managed memory as a string. SEE costs money per
    /// deployment for the same result.
    /// </para>
    /// <para>
    /// So the file is ordinary SQLite and every <c>payload</c> is a DPAPI blob. The structure —
    /// how many spans are queued, when, for which session — is readable by anybody who can read
    /// the file; the <i>content</i>, which is the part that says what somebody had open, is not.
    /// That is the right trade: the row count is operational data an administrator debugging a
    /// sync backlog genuinely wants to see, and it reveals nothing about a person.
    /// </para>
    ///
    /// <para><b>Why the queue is the source of truth, not the in-memory builder.</b></para>
    /// <para>
    /// Spans are written here the moment they close, before any upload is attempted. A crash
    /// between closing a span and uploading it therefore loses nothing, and the answer to "what
    /// has not reached the server" is a query rather than a guess. It also makes the upload path
    /// naturally idempotent: the span id is generated when the span is written and never
    /// regenerated, so a retry after a lost response carries the same ids the server has already
    /// stored and is discarded there as a duplicate.
    /// </para>
    /// </remarks>
    public sealed class SqliteOfflineQueue : IOfflineQueue
    {
        private readonly string _connectionString;
        private readonly object _gate = new object();
        private bool _disposed;

        /// <summary>
        /// Attempts before a span is given up on.
        /// </summary>
        /// <remarks>
        /// Ten, with the batch interval at three minutes, is about half an hour of trying — long
        /// enough to ride out a router reboot or a certificate renewal, short enough that a span
        /// the server will never accept does not sit at the head of the queue blocking everything
        /// behind it for ever.
        /// </remarks>
        public const int MaxAttempts = 10;

        public SqliteOfflineQueue()
            : this(Path.Combine(DeviceIdentityStore.DefaultDirectory, "queue.db"))
        {
        }

        public SqliteOfflineQueue(string databasePath)
        {
            string directory = Path.GetDirectoryName(databasePath);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
                DeviceIdentityStore.TryHardenAcl(directory);
            }

            var builder = new SQLiteConnectionStringBuilder
            {
                DataSource = databasePath,
                // WAL keeps a reader (the tray's pending count) from blocking the writer (the
                // span recorder). Without it, a UI refresh mid-write throws SQLITE_BUSY.
                JournalMode = SQLiteJournalModeEnum.Wal,
                // NORMAL rather than FULL: FULL fsyncs on every commit, which on the spinning
                // disks still in a lot of office PCs adds real latency to a write that happens
                // every few minutes all day. With WAL, NORMAL loses at most the last transaction
                // on a power cut — a few minutes of one person's spans, against a measurable
                // slowdown on every machine.
                SyncMode = SynchronizationModes.Normal,
                FailIfMissing = false,
                BusyTimeout = 5000
            };
            _connectionString = builder.ToString();

            Initialise();
        }

        private void Initialise()
        {
            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                using (SQLiteCommand command = connection.CreateCommand())
                {
                    command.CommandText = @"
CREATE TABLE IF NOT EXISTS spans (
  rowId      INTEGER PRIMARY KEY AUTOINCREMENT,
  spanId     TEXT NOT NULL UNIQUE,
  sessionId  TEXT NOT NULL,
  queuedAt   TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  lastError  TEXT,
  payload    BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spans_session ON spans (sessionId, rowId);
CREATE INDEX IF NOT EXISTS idx_spans_queuedAt ON spans (queuedAt);";
                    command.ExecuteNonQuery();
                }
            }
        }

        private SQLiteConnection Open()
        {
            var connection = new SQLiteConnection(_connectionString);
            connection.Open();
            return connection;
        }

        /// <summary>
        /// Persist finished spans.
        /// </summary>
        /// <remarks>
        /// <c>INSERT OR IGNORE</c> on the unique <c>spanId</c>: enqueueing the same span twice is
        /// a no-op rather than an error. That matters on the shutdown path, where the final flush
        /// and the ordinary batch timer can both reach the same spans.
        /// </remarks>
        public void Enqueue(string sessionId, IEnumerable<ActivitySpan> spans)
        {
            if (spans == null) return;

            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                using (SQLiteTransaction transaction = connection.BeginTransaction())
                {
                    using (SQLiteCommand command = connection.CreateCommand())
                    {
                        command.CommandText =
                            "INSERT OR IGNORE INTO spans (spanId, sessionId, queuedAt, attempts, payload) " +
                            "VALUES (@spanId, @sessionId, @queuedAt, 0, @payload)";
                        var spanId = command.Parameters.Add("@spanId", System.Data.DbType.String);
                        var session = command.Parameters.Add("@sessionId", System.Data.DbType.String);
                        var queuedAt = command.Parameters.Add("@queuedAt", System.Data.DbType.String);
                        var payload = command.Parameters.Add("@payload", System.Data.DbType.Binary);

                        foreach (ActivitySpan span in spans)
                        {
                            if (span == null || string.IsNullOrEmpty(span.SpanId)) continue;
                            spanId.Value = span.SpanId;
                            session.Value = sessionId ?? string.Empty;
                            queuedAt.Value = IsoTime.Now();
                            payload.Value = Encrypt(span);
                            command.ExecuteNonQuery();
                        }
                    }
                    transaction.Commit();
                }
            }
        }

        public IList<QueuedSpan> Peek(int max)
        {
            var results = new List<QueuedSpan>();
            if (max <= 0) return results;

            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                using (SQLiteCommand command = connection.CreateCommand())
                {
                    // Oldest first, so a long outage replays in the order things happened and the
                    // timeline reconstructs correctly even if the upload is interrupted again.
                    command.CommandText =
                        "SELECT rowId, sessionId, attempts, payload FROM spans " +
                        "WHERE attempts < @maxAttempts ORDER BY rowId ASC LIMIT @limit";
                    command.Parameters.AddWithValue("@maxAttempts", MaxAttempts);
                    command.Parameters.AddWithValue("@limit", max);

                    using (SQLiteDataReader reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var blob = (byte[])reader["payload"];
                            ActivitySpan span = Decrypt(blob);
                            if (span == null) continue;
                            results.Add(new QueuedSpan
                            {
                                RowId = Convert.ToInt64(reader["rowId"]),
                                SessionId = Convert.ToString(reader["sessionId"]),
                                Attempts = Convert.ToInt32(reader["attempts"]),
                                Span = span
                            });
                        }
                    }
                }
            }

            return results;
        }

        public void Acknowledge(IEnumerable<long> rowIds)
        {
            ExecuteForRows(rowIds, "DELETE FROM spans WHERE rowId = @rowId", null);
        }

        public void MarkFailed(IEnumerable<long> rowIds, string reason, bool permanent)
        {
            if (permanent)
            {
                // The server has told us it will never accept these. Retrying is pointless and
                // keeping them would eventually fill the disk of a PC with a persistent problem.
                ExecuteForRows(rowIds, "DELETE FROM spans WHERE rowId = @rowId", null);
                return;
            }

            ExecuteForRows(
                rowIds,
                "UPDATE spans SET attempts = attempts + 1, lastError = @reason WHERE rowId = @rowId",
                command => command.Parameters.AddWithValue("@reason", Truncate(reason, 400)));
        }

        private void ExecuteForRows(IEnumerable<long> rowIds, string sql, Action<SQLiteCommand> configure)
        {
            if (rowIds == null) return;

            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                using (SQLiteTransaction transaction = connection.BeginTransaction())
                {
                    using (SQLiteCommand command = connection.CreateCommand())
                    {
                        command.CommandText = sql;
                        var rowId = command.Parameters.Add("@rowId", System.Data.DbType.Int64);
                        if (configure != null) configure(command);
                        foreach (long id in rowIds)
                        {
                            rowId.Value = id;
                            command.ExecuteNonQuery();
                        }
                    }
                    transaction.Commit();
                }
            }
        }

        public int PendingCount()
        {
            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                using (SQLiteCommand command = connection.CreateCommand())
                {
                    command.CommandText = "SELECT COUNT(*) FROM spans WHERE attempts < @maxAttempts";
                    command.Parameters.AddWithValue("@maxAttempts", MaxAttempts);
                    return Convert.ToInt32(command.ExecuteScalar());
                }
            }
        }

        /// <summary>
        /// Drop spans older than the retention window, and spans that have exhausted their retries.
        /// </summary>
        /// <remarks>
        /// Mirrors §51 locally. A PC that has been offline for two months should not, on
        /// reconnecting, upload two months of spans the server is about to purge anyway — and a
        /// queue file that only ever grows is a support call waiting to happen on a machine with
        /// a small SSD.
        /// </remarks>
        public int Prune(TimeSpan olderThan)
        {
            string cutoff = IsoTime.Format(DateTime.UtcNow - olderThan);

            lock (_gate)
            {
                using (SQLiteConnection connection = Open())
                {
                    int removed;
                    using (SQLiteCommand command = connection.CreateCommand())
                    {
                        command.CommandText =
                            "DELETE FROM spans WHERE queuedAt < @cutoff OR attempts >= @maxAttempts";
                        command.Parameters.AddWithValue("@cutoff", cutoff);
                        command.Parameters.AddWithValue("@maxAttempts", MaxAttempts);
                        removed = command.ExecuteNonQuery();
                    }

                    if (removed > 0)
                    {
                        // Reclaim the pages: without this the file keeps its high-water mark for
                        // ever, which after one long outage is a permanently large file.
                        using (SQLiteCommand vacuum = connection.CreateCommand())
                        {
                            vacuum.CommandText = "VACUUM";
                            vacuum.ExecuteNonQuery();
                        }
                    }

                    return removed;
                }
            }
        }

        private static byte[] Encrypt(ActivitySpan span)
        {
            string json = JsonConvert.SerializeObject(span);
            return DpapiProtector.ProtectBytes(Encoding.UTF8.GetBytes(json), DpapiProtector.Purpose.OfflineQueue);
        }

        /// <summary>
        /// Decrypt one row, returning null if it cannot be read.
        /// </summary>
        /// <remarks>
        /// A row that will not decrypt means the queue was carried to another machine or the
        /// DPAPI store was rebuilt. Skipping it is right: the span is unrecoverable, and throwing
        /// would stop every subsequent span in the queue from ever being uploaded because of one
        /// bad row at the front.
        /// </remarks>
        private static ActivitySpan Decrypt(byte[] blob)
        {
            byte[] plain = DpapiProtector.UnprotectBytes(blob, DpapiProtector.Purpose.OfflineQueue);
            if (plain == null) return null;
            try
            {
                return JsonConvert.DeserializeObject<ActivitySpan>(Encoding.UTF8.GetString(plain));
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static string Truncate(string value, int max)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            return value.Length <= max ? value : value.Substring(0, max);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            // Connections are opened per operation and disposed with their using blocks, so
            // there is no long-lived handle to release. Clearing the pool releases the file lock
            // promptly, which matters for the uninstaller.
            SQLiteConnection.ClearAllPools();
        }
    }
}
