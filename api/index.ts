import appInstance from "../dist/server.cjs";

const app = (appInstance as any).default || appInstance;

export default app;
