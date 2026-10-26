package com.sel;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * Native buffer for recorded trip points and tracking gaps (Android's built-in SQLite, no extra
 * dependency). {@link TripRecorderService} writes it even while the WebView is dead; the app drains
 * it through {@link TripRecorderPlugin} and marks rows synced once its upload outbox holds them.
 * One instance per process; every method is synchronized.
 */
public final class TripPointStore extends SQLiteOpenHelper {

    private static final String DB_NAME = "sel_trip_points.db";
    private static final int DB_VERSION = 1;
    private static final String TABLE_POINTS = "trip_points";
    private static final String TABLE_GAPS = "trip_gaps";
    private static final long DAY_MS = 86_400_000L;
    private static final String[] POINT_COLUMNS = {
        "id", "client_point_id", "lat", "lng", "accuracy", "speed", "bearing", "altitude", "recorded_at"
    };

    private static volatile TripPointStore instance;

    public static TripPointStore get(Context context) {
        TripPointStore current = instance;
        if (current == null) {
            synchronized (TripPointStore.class) {
                current = instance;
                if (current == null) {
                    current = new TripPointStore(context.getApplicationContext());
                    instance = current;
                }
            }
        }
        return current;
    }

    private TripPointStore(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
        // Lets the plugin read while the service writes.
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE trip_points (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "trip_id TEXT NOT NULL, " +
                "client_point_id TEXT NOT NULL UNIQUE, " +
                "lat REAL, " +
                "lng REAL, " +
                "accuracy REAL, " +
                "speed REAL, " +
                "bearing REAL, " +
                "altitude REAL, " +
                "recorded_at INTEGER NOT NULL, " +
                "synced INTEGER NOT NULL DEFAULT 0, " +
                "synced_at INTEGER)"
        );
        db.execSQL("CREATE INDEX idx_trip_points_sync ON trip_points(trip_id, synced, recorded_at)");
        db.execSQL(
            "CREATE TABLE trip_gaps (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "trip_id TEXT NOT NULL, " +
                "from_ms INTEGER NOT NULL, " +
                "to_ms INTEGER NOT NULL, " +
                "synced INTEGER NOT NULL DEFAULT 0, " +
                "synced_at INTEGER)"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Version 1 is the first schema; later versions add their migrations here.
    }

    // Points

    /** @return the new row id, or -1 when the clientPointId already exists (the row is ignored). */
    public synchronized long insertPoint(
        String tripId,
        String clientPointId,
        double lat,
        double lng,
        @Nullable Double accuracy,
        @Nullable Double speed,
        @Nullable Double bearing,
        @Nullable Double altitude,
        long recordedAt
    ) {
        ContentValues values = new ContentValues();
        values.put("trip_id", tripId);
        values.put("client_point_id", clientPointId);
        values.put("lat", lat);
        values.put("lng", lng);
        values.put("accuracy", accuracy);
        values.put("speed", speed);
        values.put("bearing", bearing);
        values.put("altitude", altitude);
        values.put("recorded_at", recordedAt);
        return getWritableDatabase().insertWithOnConflict(
            TABLE_POINTS,
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        );
    }

    /**
     * Unsynced points of a trip, oldest first. Ordered by id (insertion order) so that
     * {@link #markSynced} "up to id" covers exactly the rows handed out; the recorder only accepts
     * strictly newer fixes, so id order is also recorded_at order.
     */
    public synchronized List<Point> unsyncedPoints(String tripId, int limit) {
        List<Point> points = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query(
            TABLE_POINTS,
            POINT_COLUMNS,
            "trip_id = ? AND synced = 0",
            new String[]{ tripId },
            null,
            null,
            "id ASC",
            String.valueOf(Math.max(1, limit))
        )) {
            while (cursor.moveToNext()) {
                points.add(new Point(
                    cursor.getLong(0),
                    cursor.getString(1),
                    cursor.getDouble(2),
                    cursor.getDouble(3),
                    optDouble(cursor, 4),
                    optDouble(cursor, 5),
                    optDouble(cursor, 6),
                    optDouble(cursor, 7),
                    cursor.getLong(8)
                ));
            }
        }
        return points;
    }

    public synchronized int markSynced(String tripId, long upToId, long syncedAt) {
        ContentValues values = new ContentValues();
        values.put("synced", 1);
        values.put("synced_at", syncedAt);
        return getWritableDatabase().update(
            TABLE_POINTS,
            values,
            "trip_id = ? AND synced = 0 AND id <= ?",
            new String[]{ tripId, String.valueOf(upToId) }
        );
    }

    public synchronized Counts counts(String tripId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END), 0) " +
                "FROM trip_points WHERE trip_id = ?",
            new String[]{ tripId }
        )) {
            if (cursor.moveToFirst()) {
                return new Counts(cursor.getLong(0), cursor.getLong(1));
            }
        }
        return new Counts(0L, 0L);
    }

    /** The newest stored point of a trip, or null. Used to restore the jitter filter after a kill. */
    @Nullable
    public synchronized LastPoint lastPoint(String tripId) {
        try (Cursor cursor = getReadableDatabase().query(
            TABLE_POINTS,
            new String[]{ "recorded_at", "lat", "lng" },
            "trip_id = ?",
            new String[]{ tripId },
            null,
            null,
            "recorded_at DESC",
            "1"
        )) {
            if (cursor.moveToFirst()) {
                return new LastPoint(cursor.getLong(0), cursor.getDouble(1), cursor.getDouble(2));
            }
        }
        return null;
    }

    // Gaps

    public synchronized long insertGap(String tripId, long fromMs, long toMs) {
        ContentValues values = new ContentValues();
        values.put("trip_id", tripId);
        values.put("from_ms", fromMs);
        values.put("to_ms", toMs);
        return getWritableDatabase().insert(TABLE_GAPS, null, values);
    }

    public synchronized List<Gap> unsyncedGaps(String tripId) {
        List<Gap> gaps = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query(
            TABLE_GAPS,
            new String[]{ "id", "from_ms", "to_ms" },
            "trip_id = ? AND synced = 0",
            new String[]{ tripId },
            null,
            null,
            "id ASC"
        )) {
            while (cursor.moveToNext()) {
                gaps.add(new Gap(cursor.getLong(0), cursor.getLong(1), cursor.getLong(2)));
            }
        }
        return gaps;
    }

    public synchronized int markGapsSynced(String tripId, long upToId, long syncedAt) {
        ContentValues values = new ContentValues();
        values.put("synced", 1);
        values.put("synced_at", syncedAt);
        return getWritableDatabase().update(
            TABLE_GAPS,
            values,
            "trip_id = ? AND synced = 0 AND id <= ?",
            new String[]{ tripId, String.valueOf(upToId) }
        );
    }

    public synchronized long countUnsyncedGaps(String tripId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT COUNT(*) FROM trip_gaps WHERE trip_id = ? AND synced = 0",
            new String[]{ tripId }
        )) {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0L;
        }
    }

    // Housekeeping

    /** Deletes synced points and gaps whose sync is older than the given days. Unsynced rows stay. */
    public synchronized int purgeSynced(int olderThanDays, long now) {
        String cutoff = String.valueOf(now - Math.max(0, olderThanDays) * DAY_MS);
        String where = "synced = 1 AND synced_at IS NOT NULL AND synced_at < ?";
        SQLiteDatabase db = getWritableDatabase();
        int deleted = db.delete(TABLE_POINTS, where, new String[]{ cutoff });
        deleted += db.delete(TABLE_GAPS, where, new String[]{ cutoff });
        return deleted;
    }

    @Nullable
    private static Double optDouble(Cursor cursor, int index) {
        return cursor.isNull(index) ? null : cursor.getDouble(index);
    }

    public static final class Point {
        public final long id;
        public final String clientPointId;
        public final double lat;
        public final double lng;
        @Nullable public final Double accuracy;
        @Nullable public final Double speed;
        @Nullable public final Double bearing;
        @Nullable public final Double altitude;
        public final long recordedAt;

        Point(
            long id,
            String clientPointId,
            double lat,
            double lng,
            @Nullable Double accuracy,
            @Nullable Double speed,
            @Nullable Double bearing,
            @Nullable Double altitude,
            long recordedAt
        ) {
            this.id = id;
            this.clientPointId = clientPointId;
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
            this.speed = speed;
            this.bearing = bearing;
            this.altitude = altitude;
            this.recordedAt = recordedAt;
        }
    }

    public static final class Gap {
        public final long id;
        public final long fromMs;
        public final long toMs;

        Gap(long id, long fromMs, long toMs) {
            this.id = id;
            this.fromMs = fromMs;
            this.toMs = toMs;
        }
    }

    public static final class Counts {
        public final long accepted;
        public final long unsynced;

        Counts(long accepted, long unsynced) {
            this.accepted = accepted;
            this.unsynced = unsynced;
        }
    }

    public static final class LastPoint {
        public final long recordedAt;
        public final double lat;
        public final double lng;

        LastPoint(long recordedAt, double lat, double lng) {
            this.recordedAt = recordedAt;
            this.lat = lat;
            this.lng = lng;
        }
    }
}
