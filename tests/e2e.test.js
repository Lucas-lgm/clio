"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var child_process_1 = require("child_process");
var path_1 = require("path");
var fs_1 = require("fs");
var DIST = (0, path_1.join)(__dirname, '..', 'dist');
var SERVER = (0, path_1.join)(DIST, 'server.js');
(0, vitest_1.describe)('Clio E2E', function () {
    (0, vitest_1.afterAll)(function () {
        var sock = '/tmp/clio-test-e2e/clio.sock';
        if ((0, fs_1.existsSync)(sock))
            (0, fs_1.unlinkSync)(sock);
    });
    (0, vitest_1.it)('should start and respond to IPC requests', function () { return __awaiter(void 0, void 0, void 0, function () {
        var proc, connect, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    proc = (0, child_process_1.spawn)('node', [SERVER], {
                        env: __assign(__assign({}, process.env), { CLIO_HOME: '/tmp/clio-test-e2e', NODE_ENV: 'test' }),
                        stdio: ['pipe', 'pipe', 'pipe'],
                    });
                    // Wait for socket to be ready
                    return [4 /*yield*/, new Promise(function (resolve) {
                            proc.stderr.on('data', function (data) {
                                var text = data.toString();
                                if (text.includes('ipc socket ready'))
                                    resolve();
                            });
                            setTimeout(resolve, 3000);
                        })];
                case 1:
                    // Wait for socket to be ready
                    _a.sent();
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('net'); })];
                case 2:
                    connect = (_a.sent()).connect;
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var client = connect('/tmp/clio-test-e2e/clio.sock', function () {
                                client.write(JSON.stringify({ id: 'test-1', type: 'recall_initial_context', payload: {} }) + '\n');
                            });
                            var buf = '';
                            client.on('data', function (chunk) {
                                buf += chunk;
                                var nl = buf.indexOf('\n');
                                if (nl >= 0) {
                                    resolve(JSON.parse(buf.slice(0, nl)));
                                    client.destroy();
                                }
                            });
                            client.on('error', reject);
                            setTimeout(function () { client.destroy(); reject(new Error('timeout')); }, 3000);
                        })];
                case 3:
                    result = _a.sent();
                    (0, vitest_1.expect)(result).toHaveProperty('success', true);
                    (0, vitest_1.expect)(result).toHaveProperty('id', 'test-1');
                    proc.kill();
                    return [2 /*return*/];
            }
        });
    }); });
});
