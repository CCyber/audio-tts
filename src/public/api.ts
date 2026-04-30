export interface Project {
  id: number;
  name: string;
  is_system: number;
  recording_count: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface TagWithCount extends Tag {
  count: number;
}

export interface Recording {
  id: number;
  project_id: number;
  title: string;
  original_text: string;
  voice: string;
  model: string;
  file_path: string;
  file_size: number;
  duration_ms: number;
  created_at: string;
  tags: Tag[];
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => jsonFetch<{ items: Project[] }>("/api/projects").then((r) => r.items),
  createProject: (name: string) =>
    jsonFetch<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  renameProject: (id: number, name: string) =>
    jsonFetch<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteProject: (id: number) =>
    jsonFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),

  listTags: () => jsonFetch<{ items: TagWithCount[] }>("/api/tags").then((r) => r.items),

  listRecordings: (params: {
    projectId?: number;
    tags?: string[];
    q?: string;
  }) => {
    const url = new URL("/api/recordings", location.origin);
    if (params.projectId !== undefined) url.searchParams.set("project_id", String(params.projectId));
    (params.tags ?? []).forEach((t) => url.searchParams.append("tag", t));
    if (params.q) url.searchParams.set("q", params.q);
    return jsonFetch<{ items: Recording[] }>(url.pathname + url.search).then((r) => r.items);
  },
  getRecording: (id: number) => jsonFetch<Recording>(`/api/recordings/${id}`),
  updateRecording: (
    id: number,
    body: { title?: string; project_id?: number; tags?: string[] }
  ) =>
    jsonFetch<Recording>(`/api/recordings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteRecording: (id: number) =>
    jsonFetch<void>(`/api/recordings/${id}`, { method: "DELETE" }),

  generateRecording: async (form: FormData) => {
    const res = await fetch("/api/recordings", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as Recording;
  },

  listVoices: () =>
    jsonFetch<{ items: Array<{ _id: string; title: string }> }>("/api/voices").then((r) => r.items),
  listModels: () => jsonFetch<{ items: string[] }>("/api/models").then((r) => r.items),
};
