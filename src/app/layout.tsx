import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";
import { MeProvider } from "@/components/providers/me-provider";
import { DialogsProvider } from "@/components/providers/dialogs-provider";

// The fonts ship with the app (the @fontsource-variable packages, OFL) rather
// than coming from Google Fonts, so a bad answer from Google can never fail a
// build.
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans",
});

// Titles and headline figures; Inter carries everything else.
const jakarta = localFont({
  src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Takeaway Counter",
  description: "Phone orders and customers for the takeaway",
  appleWebApp: { capable: true, title: "Orders", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#241412",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="h-full bg-background text-foreground overflow-hidden">
        <SessionProvider>
          <MeProvider>
            <DialogsProvider>
              <MainWrapper>{children}</MainWrapper>
            </DialogsProvider>
          </MeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
