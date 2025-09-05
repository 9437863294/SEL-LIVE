'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Module } from '@/lib/types';

interface ModuleContextType {
  modules: Module[];
  addModule: (module: Omit<Module, 'id'>) => void;
  deleteModule: (id: string) => void;
  updateModuleOrder: (modules: Module[]) => void;
  isLoading: boolean;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<Module[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem('modules');
      if (item) {
        setModules(JSON.parse(item));
      }
    } catch (error) {
      console.error('Failed to load modules from local storage', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      try {
        window.localStorage.setItem('modules', JSON.stringify(modules));
      } catch (error) {
        console.error('Failed to save modules to local storage', error);
      }
    }
  }, [modules, isLoading]);

  const addModule = useCallback((moduleData: Omit<Module, 'id'>) => {
    const newModule: Module = {
      ...moduleData,
      id: Date.now().toString(),
    };
    setModules((prev) => [...prev, newModule]);
  }, []);

  const deleteModule = useCallback((id: string) => {
    setModules((prev) => prev.filter((module) => module.id !== id));
  }, []);

  const updateModuleOrder = useCallback((newOrder: Module[]) => {
    setModules(newOrder);
  }, []);
  
  const value = { modules, addModule, deleteModule, updateModuleOrder, isLoading };

  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

export function useModules() {
  const context = useContext(ModuleContext);
  if (context === undefined) {
    throw new Error('useModules must be used within a ModuleProvider');
  }
  return context;
}
