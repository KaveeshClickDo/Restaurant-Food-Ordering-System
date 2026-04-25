export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f9fafb", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
