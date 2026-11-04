import type { BridgeDescriptor, BridgeEvent } from './types';
/** 事件流通道。 */
export type EventStreamListener = (event: BridgeEvent) => void;
/** 一次事件拉取的结果。 */
export interface EventPollResult {
    /** 新的游标（下次带上即可）。 */
    cursor: number;
    /** 本次拉到的件。 */
    events: BridgeEvent[];
}
/** 默认的事件轮询间隔（毫秒）。 */
export declare const DEFAULT_EVENT_POLL_INTERVAL_MS = 1000;
/**
 * 与桥通信的传输层。
 *
 * - 命令调用走 `POST /invoke`（同步、易用 curl 调试）；
 * - 事件流走 `GET /events`（SSE，单向推送 + 自动重连）。
 */
export declare class BridgeTransport {
    private readonly resolveDescriptor;
    private readonly fetchImpl?;
    constructor(resolveDescriptor: () => Promise<BridgeDescriptor | null>, fetchImpl?: typeof fetch | undefined);
    private get fetch();
    /**
     * 调用一个后端命令。
     *
     * 失败时以**原始错误负载** reject——与 Tauri 官方 `invoke` 的语义一致，
     * 这样业务代码里的 `catch (e)` 无需区分两种错误来源。
     */
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    /**
     * 拉取自 `since` 之后的事件。
     *
     * 用**短轮询**而非 SSE / WebSocket：长连接会让浏览器自动化工具的
     * *networkidle* 判定永远无法达成（`agent-browser open` 之类的命令会一直挂起），
     * 而轮询在两次请求之间留出了空闲窗口。
     */
    pollEvents(since: number): Promise<EventPollResult>;
    /**
     * 启动事件轮询，返回一个停止函数。
     *
     * 用 `setTimeout` 串联而非 `setInterval`，避免上一次请求未完成时叠加上一次。
     */
    startEventPolling(listener: EventStreamListener, intervalMs?: number): () => void;
}
//# sourceMappingURL=transport.d.ts.map