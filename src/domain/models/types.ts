// Immutable gameplay contracts (GDD 4, 5, 8.1). Free of Pixi, DOM, storage and audio types.

/** Integer grid coordinate: x grows right, y grows down, (0,0) is top-left. */
export type Cell = readonly [x: number, y: number];

export interface ShapeDefinition {
  readonly id: string;
  /** Normalized: min x = 0 and min y = 0; sorted by y then x. The (0,0) cell may be absent. */
  readonly cells: readonly Cell[];
  readonly weight: number;
  readonly width: number;
  readonly height: number;
}

export interface ScoreRules {
  readonly pointsPerPlacedCell: number;
  readonly pointsPerCompletedLine: number;
}

export const GENERATOR_ALGORITHM = 'xorshift32_v1';
export const GENERATOR_VERSION = 1;

/** Effective rules for one run, frozen when the run starts. */
export interface GameplayConfig {
  readonly rulesetId: string;
  readonly catalogId: string;
  readonly columns: number;
  readonly rows: number;
  readonly traySize: number;
  readonly score: ScoreRules;
  readonly catalog: readonly ShapeDefinition[];
  readonly totalWeight: number;
}

/** A shape id identifies the tile; presentation maps it to a color, so cosmetic edits never touch saves. */
export type TileKey = string;

export interface BoardState {
  readonly columns: number;
  readonly rows: number;
  /** Row-major, index = y * columns + x. */
  readonly cells: readonly (TileKey | null)[];
}

export interface SlotInstance {
  /** Unique within a session; a refilled slot gets a new id so stale input cannot target it. */
  readonly instanceId: number;
  readonly shapeId: string;
}

export interface GeneratorState {
  readonly algorithm: typeof GENERATOR_ALGORITHM;
  readonly version: typeof GENERATOR_VERSION;
  /** Unsigned 32-bit, nonzero. */
  readonly seed: number;
  readonly state: number;
}

export type SessionStatus = 'active' | 'game_over';

export interface SessionState {
  readonly sessionId: string;
  readonly gameplayHash: string;
  /** Increases once per accepted move. */
  readonly revision: number;
  readonly board: BoardState;
  /** Fixed length = traySize; null marks a consumed slot. */
  readonly tray: readonly (SlotInstance | null)[];
  readonly score: number;
  readonly status: SessionStatus;
  readonly generator: GeneratorState;
  readonly nextInstanceId: number;
}

export interface PlacePiece {
  readonly type: 'PlacePiece';
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly instanceId: number;
  /** Board cell that receives the shape's local (0,0) bounding-box origin. */
  readonly anchor: Cell;
}

export interface MoveResult {
  readonly accepted: true;
  readonly moveId: number;
  readonly placed: readonly Cell[];
  readonly completedRows: readonly number[];
  readonly completedColumns: readonly number[];
  readonly cleared: readonly Cell[];
  readonly scoreDelta: number;
  readonly consumedInstanceId: number;
  readonly dealt: readonly SlotInstance[];
  readonly status: SessionStatus;
  readonly state: SessionState;
}

export type RejectionReason = 'stale_session' | 'stale_revision' | 'unknown_slot' | 'illegal_placement' | 'game_over';

export interface MoveRejection {
  readonly accepted: false;
  readonly reason: RejectionReason;
}
