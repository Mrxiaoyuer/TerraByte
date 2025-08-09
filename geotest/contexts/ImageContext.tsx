"use client";

import React, { createContext, useState } from "react";

interface ImageContextValue {
  image: string | null;
  setImage: (v: string | null) => void;
}

export const ImageContext = createContext<ImageContextValue | null>(null);

export function ImageProvider({ children }: { children: React.ReactNode }) {
  const [image, setImage] = useState<string | null>(null);

  return (
    <ImageContext.Provider value={{ image, setImage }}>
      {children}
    </ImageContext.Provider>
  );
}
