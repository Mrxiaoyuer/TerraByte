"use client";

import React, { createContext, useState } from "react";
import type { Location } from "@/lib/types";

interface LocationsContextValue {
  locations: Location[];
  setLocations: (l: Location[]) => void;
}

export const LocationsContext = createContext<LocationsContextValue | null>(null);

export function LocationsProvider({ children }: { children: React.ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);

  return (
    <LocationsContext.Provider value={{ locations, setLocations }}>
      {children}
    </LocationsContext.Provider>
  );
}
