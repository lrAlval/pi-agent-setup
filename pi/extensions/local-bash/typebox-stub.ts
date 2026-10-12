import { mock } from 'bun:test';
mock.module('typebox', () => ({
	Type: new Proxy({}, { get: () => (..._args: unknown[]) => ({}) }),
}));
