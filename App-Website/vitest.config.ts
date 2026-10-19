import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['shared/**/*.test.ts','server/**/*.test.ts','src/**/*.test.ts'],pool:'forks',testTimeout:30000,hookTimeout:30000}});
