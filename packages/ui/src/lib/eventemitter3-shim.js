/**
 * Re-export eventemitter3 so both default and named imports work for bundlers.
 * Dependencies (e.g. rpc-websockets) use: import { EventEmitter } from 'eventemitter3'
 * eventemitter3-real is transformed by commonjs plugin to export default only; we re-export as EventEmitter here.
 */
import EventEmitter from 'eventemitter3-real';
export { EventEmitter };
export default EventEmitter;
