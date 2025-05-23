import * as vscode from "vscode";

export interface CacheItem<T> {
  data: T;
  timestamp: number;
  lastUpdateId?: string;
}

export class CacheService {
  private cache: Map<string, CacheItem<any>> = new Map();
  private storageService: vscode.Memento;
  private readonly PERSIST_KEYS = [
    "issues",
    "teams",
    "workflowStates",
    "projects",
  ];

  constructor(context: vscode.ExtensionContext) {
    this.storageService = context.globalState;
    this.loadPersistedCache();
  }

  /**
   * キャッシュから値を取得する
   * @param key キー
   * @param ttl ミリ秒単位の有効期限（デフォルト: 5分）
   * @returns キャッシュされた値、または期限切れの場合はnull
   */
  get<T>(key: string, ttl: number = 5 * 60 * 1000): T | null {
    const item = this.cache.get(key);
    if (!item) {
      console.log(`Cache miss: ${key}`);
      return null;
    }

    if (ttl > 0 && Date.now() - item.timestamp > ttl) {
      console.log(
        `Cache expired: ${key}, age: ${(Date.now() - item.timestamp) / 1000}s`
      );
      this.cache.delete(key);
      return null;
    }

    console.log(
      `Cache hit: ${key}, age: ${(Date.now() - item.timestamp) / 1000}s`
    );

    // データの検証 (特にIssue配列の場合)
    if (Array.isArray(item.data)) {
      const itemCount = item.data.length;
      console.log(`Cached array contains ${itemCount} items`);

      // 先頭の数アイテムをサンプルとして検査
      const sampleSize = Math.min(3, itemCount);
      for (let i = 0; i < sampleSize; i++) {
        const sample = item.data[i];
        if (sample && typeof sample === "object") {
          console.log(
            `Sample item #${i}:`,
            sample.id ? `id: ${sample.id.substring(0, 8)}...` : "no id",
            sample.title
              ? `title: ${sample.title.substring(0, 15)}...`
              : "no title",
            sample.state ? `state: ${typeof sample.state}` : "no state"
          );
        }
      }
    }

    return item.data as T;
  }

  /**
   * キャッシュに値を設定する
   * @param key キー
   * @param data データ
   * @param lastUpdateId 最後の更新ID
   */
  set<T>(key: string, data: T, lastUpdateId?: string): void {
    console.log(
      `Setting cache: ${key}`,
      Array.isArray(data) ? `(${data.length} items)` : ""
    );

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      lastUpdateId,
    });

    // 永続化が必要なキーの場合、保存する
    if (this.shouldPersist(key)) {
      this.persistCache();
    }
  }

  /**
   * キャッシュから指定したプレフィックスを持つキーをすべて削除する
   * @param prefix 削除するキーのプレフィックス
   */
  invalidateByPrefix(prefix: string): void {
    const keysToDelete = Array.from(this.cache.keys()).filter((k) =>
      k.startsWith(prefix)
    );
    keysToDelete.forEach((key) => this.cache.delete(key));

    if (keysToDelete.some((key) => this.shouldPersist(key))) {
      this.persistCache();
    }
  }

  /**
   * キャッシュからキーを削除する
   * @param key 削除するキー
   */
  delete(key: string): void {
    this.cache.delete(key);

    if (this.shouldPersist(key)) {
      this.persistCache();
    }
  }

  /**
   * キャッシュをすべてクリアする
   */
  clear(): void {
    this.cache.clear();
    this.persistCache();
  }

  /**
   * 指定されたキーの最終更新IDを取得する
   * @param key キー
   * @returns 最終更新ID、または未設定の場合はundefined
   */
  getLastUpdateId(key: string): string | undefined {
    const item = this.cache.get(key);
    return item?.lastUpdateId;
  }

  /**
   * キーが永続化の対象かどうかを判定する
   * @param key キー
   * @returns 永続化が必要な場合はtrue
   */
  private shouldPersist(key: string): boolean {
    return this.PERSIST_KEYS.some((prefix) => key.startsWith(prefix));
  }

  /**
   * キャッシュを永続ストレージに保存する
   */
  private persistCache(): void {
    const persistData: Record<string, CacheItem<any>> = {};

    this.cache.forEach((value, key) => {
      if (this.shouldPersist(key)) {
        persistData[key] = value;
      }
    });

    this.storageService.update("linearCache", persistData);
  }

  /**
   * 永続ストレージからキャッシュを読み込む
   */
  private loadPersistedCache(): void {
    const persistedData =
      this.storageService.get<Record<string, CacheItem<any>>>("linearCache");

    console.log(
      "Loading cache:",
      persistedData ? Object.keys(persistedData).length : 0,
      "items"
    );

    if (persistedData) {
      Object.entries(persistedData).forEach(([key, value]) => {
        this.cache.set(key, value);
      });
    }
  }
}
