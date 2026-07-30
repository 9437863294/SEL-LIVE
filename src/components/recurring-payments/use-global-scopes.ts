"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Department, Project } from "@/lib/types";

/** Uses the application's canonical Settings > Projects and Departments data. */
export function useGlobalScopes() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDepartments, setLoadingDepartments] = useState(true);

  useEffect(() => {
    const stopProjects = onSnapshot(
      collection(db, "projects"),
      (snapshot) => {
        setProjects(
          snapshot.docs.map(
            (item) => ({ id: item.id, ...item.data() }) as Project,
          ),
        );
        setLoadingProjects(false);
      },
      () => setLoadingProjects(false),
    );
    const stopDepartments = onSnapshot(
      collection(db, "departments"),
      (snapshot) => {
        setDepartments(
          snapshot.docs.map(
            (item) => ({ id: item.id, ...item.data() }) as Department,
          ),
        );
        setLoadingDepartments(false);
      },
      () => setLoadingDepartments(false),
    );
    return () => {
      stopProjects();
      stopDepartments();
    };
  }, []);

  const activeProjects = useMemo(
    () =>
      projects
        .filter((item) => item.status !== "Inactive")
        .sort((a, b) => a.projectName.localeCompare(b.projectName)),
    [projects],
  );
  const activeDepartments = useMemo(
    () =>
      departments
        .filter((item) => item.status !== "Inactive")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [departments],
  );

  return {
    projects,
    departments,
    activeProjects,
    activeDepartments,
    loading: loadingProjects || loadingDepartments,
    projectName: (id?: string) =>
      projects.find((item) => item.id === id)?.projectName || "",
    departmentName: (id?: string) =>
      departments.find((item) => item.id === id)?.name || "",
  };
}
