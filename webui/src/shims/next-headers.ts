// Cookie jar backed by localStorage (the APK's WebView origin has no server to set cookies).
const KEY = "heretic-cookies";
let memory: Record<string, string> = {};

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return memory;
  }
}

function save(jar: Record<string, string>) {
  memory = jar;
  try {
    localStorage.setItem(KEY, JSON.stringify(jar));
  } catch {
    /* storage unavailable: keep in memory for this session */
  }
}

export async function cookies() {
  return {
    get(name: string) {
      const value = load()[name];
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string, _options?: Record<string, unknown>) {
      const jar = load();
      jar[name] = value;
      save(jar);
    },
    delete(name: string) {
      const jar = load();
      delete jar[name];
      save(jar);
    },
  };
}
