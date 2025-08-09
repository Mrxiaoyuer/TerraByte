import "./globals.css";

export const metadata = {
  title: "geotest",
  description: "Minimal geotest app (map + capture)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
