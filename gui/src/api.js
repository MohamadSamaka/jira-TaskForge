import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        console.error('API Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

export const system = {
    sync: (useDb = false) => api.post('/sync', { use_db: useDb }),
    authTest: () => api.post('/auth-test'),
    getConfig: () => api.get('/config'),
    getDoctor: () => api.get('/doctor'),
    init: () => api.post('/init'),
};

export const issues = {
    list: (params) => api.get('/issues', { params }),
    tree: () => api.get('/issues/tree'),
    get: (key) => api.get(`/issues/${key}`),
    focus: (key) => api.get(`/focus/${key}`),
    search: (jql, useCache = true) => api.get('/search', { params: { jql, use_cache: useCache } }),
    assignees: (project) => api.get('/issues/assignees', { params: project ? { project } : {} }),
};

export const queries = {
    blocked: () => api.get('/query/blocked'),
    next: (top = 10) => api.get('/query/next', { params: { top } }),
    today: () => api.get('/query/today'),
    byProject: () => api.get('/query/by-project'),
};

export const render = {
    json: () => api.get('/render/json'),
    md: () => api.get('/render/md'),
};

export const ai = {
    status: () => api.get('/ai/status'),
    models: () => api.get('/ai/models'),
    setModel: (name, tier = 'default') => api.post('/ai/set-model', { name, tier }),
    ask: (question, model, skipLocal = false, config = {}) =>
        api.post('/ai/ask', { question, model, skip_local: skipLocal }, config),
    today: (model, skipLocal = false, config = {}) =>
        api.post('/ai/today', { model, skip_local: skipLocal }, config),
    next: (model, skipLocal = false, config = {}) =>
        api.post('/ai/next', { model, skip_local: skipLocal }, config),
};

export default api;
