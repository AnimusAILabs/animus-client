import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import fs from 'node:fs'; // Import Node.js fs module
import path from 'node:path'; // Import Node.js path module

// Read and parse package.json manually
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
const pkg = JSON.parse(packageJsonContent);


export default {
  input: 'src/index.ts', // Entry point
  output: [
    {
      file: pkg.main, // dist/animus-sdk.umd.js
      format: 'umd', // Universal Module Definition (works in script tags)
      name: 'AnimusSDK', // Global variable name for UMD build
      sourcemap: true,
    },
    {
      file: pkg.module, // dist/animus-sdk.esm.js
      format: 'esm', // ES Module (for modern bundlers/browsers)
      sourcemap: true,
    },
  ],
  plugins: [
    json(), // Add the json plugin here
    resolve({ browser: true }), // Resolve node modules, prioritizing browser versions
    commonjs(), // Convert CommonJS modules to ES6
    typescript({
      tsconfig: './tsconfig.json', // Point to your tsconfig file
      sourceMap: true,
      declaration: true, // Let the plugin handle declaration generation
      declarationDir: 'dist/types',
    }),
  ],
};