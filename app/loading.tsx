export default function Loading() {
  return (
    <main className="system-state-page" aria-busy="true" aria-live="polite">
      <section className="system-state-card">
        <span className="loading-mark" aria-hidden="true">NG</span>
        <p>กำลังเชื่อมต่อข้อมูล</p>
        <h1>กำลังเตรียมระบบ NATHEE</h1>
        <div className="loading-bar" aria-hidden="true"><i /></div>
      </section>
    </main>
  );
}
