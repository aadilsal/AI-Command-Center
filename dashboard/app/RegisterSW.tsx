"use client";

import { useEffect } from "react";

// Registers the service worker that makes the dashboard installable as an app
export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
