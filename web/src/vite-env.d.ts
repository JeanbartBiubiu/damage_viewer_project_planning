/// <reference types="vite/client" />

declare const __DAMAGE_DEPLOYMENT_MODE__: 'viewer' | 'maintenance';
declare module '#damage-workspace' {
  const Workspace: import('react').ComponentType;
  export default Workspace;
}
