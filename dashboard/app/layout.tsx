import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import Sidebar from "./Sidebar";

export const metadata: Metadata = {
  title: "Aadil AI Command Center",
  description: "TechVersa and Career Operations Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
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
