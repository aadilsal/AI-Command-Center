import type { MetadataRoute } from "next";

// Makes the dashboard installable as its own app (own window + shelf icon on ChromeOS)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aadil AI Command Center",
    short_name: "Command Center",
    description: "Your agents, Autopilot and pipeline in one place",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#05070a",
    theme_color: "#05070a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
