/** Only the separate HTML entry enables fixtures. Normal service routes stay live. */
export const isMockMode = typeof window !== 'undefined' && window.location.pathname.endsWith('/mock.html');
export const storageKey = (key: string) => isMockMode ? `pulda.mock.${key}` : key;
