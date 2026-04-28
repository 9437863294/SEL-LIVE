'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuth } from '@/components/auth/AuthProvider';

export interface SelectOption {
  value: string;
  label: string;
}

const normalizeMobile = (value?: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10) return digits.slice(-10);
  return digits;
};

const toSortedOptions = (rows: Record<string, any>[], labelGetter: (row: Record<string, any>) => string) =>
  rows
    .map((row) => ({
      value: row.id as string,
      label: labelGetter(row),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

const toRowMap = (rows: Record<string, any>[]) => {
  const table: Record<string, Record<string, any>> = {};
  rows.forEach((row) => {
    table[row.id as string] = row;
  });
  return table;
};

export const useVehicleOptions = () => {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to fetch vehicle options', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo<SelectOption[]>(
    () =>
      toSortedOptions(
        rows,
        (row) => `${row.vehicleNumber || row.registrationNo || 'Unknown'}${row.vehicleType ? ` (${row.vehicleType})` : ''}`
      ),
    [rows]
  );

  const map = useMemo(() => toRowMap(rows), [rows]);

  return { rows, options, map, isLoading };
};

export const useDriverOptions = () => {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.driver));
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to fetch driver options', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo<SelectOption[]>(
    () => toSortedOptions(rows, (row) => String(row.driverName || 'Unknown Driver')),
    [rows]
  );

  const map = useMemo(() => toRowMap(rows), [rows]);

  return { rows, options, map, isLoading };
};

export const useProjectOptions = () => {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'projects'));
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to fetch project options', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo<SelectOption[]>(
    () => toSortedOptions(rows, (row) => String(row.projectName || row.name || 'Unknown Project')),
    [rows]
  );

  const map = useMemo(() => toRowMap(rows), [rows]);

  return { rows, options, map, isLoading };
};

export const useDepartmentOptions = () => {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'departments'));
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to fetch department options', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo<SelectOption[]>(
    () => toSortedOptions(rows, (row) => String(row.name || 'Unknown Department')),
    [rows]
  );

  const map = useMemo(() => toRowMap(rows), [rows]);

  return { rows, options, map, isLoading };
};

export const useCurrentDriverProfile = () => {
  const { user } = useAuth();
  const [driver, setDriver] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) {
        setDriver(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const byLinkedUser = await getDocs(
          query(collection(db, VEHICLE_COLLECTIONS.driver), where('linkedUserId', '==', user.id))
        );
        if (!byLinkedUser.empty) {
          const doc = byLinkedUser.docs[0];
          setDriver({ id: doc.id, ...doc.data() });
          return;
        }

        if (user.mobile) {
          const byMobile = await getDocs(
            query(collection(db, VEHICLE_COLLECTIONS.driver), where('mobileNumber', '==', user.mobile))
          );
          if (!byMobile.empty) {
            const doc = byMobile.docs[0];
            setDriver({ id: doc.id, ...doc.data() });
            return;
          }

          const allDriversSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.driver));
          const me = normalizeMobile(user.mobile);
          const matched = allDriversSnap.docs.find((entry) => {
            const data = entry.data() as Record<string, any>;
            return normalizeMobile(String(data.mobileNumber || '')) === me;
          });
          if (matched) {
            setDriver({ id: matched.id, ...matched.data() });
            return;
          }
        }

        setDriver(null);
      } catch (error) {
        console.error('Failed to fetch current driver profile', error);
        setDriver(null);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [user?.id, user?.mobile]);

  return { driver, isLoading };
};

export const useUserOptions = () => {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'users'));
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to fetch user options', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const options = useMemo<SelectOption[]>(
    () =>
      toSortedOptions(rows, (row) => {
        const name = String(row.name || 'Unknown User');
        const email = String(row.email || '');
        const mobile = String(row.mobile || '');
        const meta = [email, mobile].filter(Boolean).join(' | ');
        return meta ? `${name} (${meta})` : name;
      }),
    [rows]
  );

  const map = useMemo(() => toRowMap(rows), [rows]);

  const mobileToUserId = useMemo(() => {
    const index: Record<string, string> = {};
    rows.forEach((row) => {
      const normalized = normalizeMobile(String(row.mobile || ''));
      if (!normalized) return;
      if (!index[normalized]) {
        index[normalized] = String(row.id || '');
      }
    });
    return index;
  }, [rows]);

  return { rows, options, map, mobileToUserId, isLoading };
};
