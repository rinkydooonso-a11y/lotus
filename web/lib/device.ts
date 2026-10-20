export function deviceId(): string {
  try {
    let id = localStorage.getItem("lotus_device");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("lotus_device", id); }
    return id;
  } catch { return "no-storage-" + Math.random().toString(36).slice(2, 12); }
}
