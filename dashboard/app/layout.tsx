import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import Sidebar from "./Sidebar";
import RegisterSW from "./RegisterSW";

export const metadata: Metadata = {
  title: "Aadil AI Command Center",
  description: "TechVersa and Career Operations Dashboard",
  applicationName: "Command Center",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#05070a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <RegisterSW />
        <ConvexClientProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
