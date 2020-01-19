import {
	APIPhase,
	HeartbeatEvent,
	PhaseConfig,
	SavedGame,
	TimerStatus,
	TurnConfig,
} from "@web/types/data";
import { EventEmitter } from "events";
import _ from "lodash";
import uuid from "uuid/v4";

const MINUTES = 60 * 1000;

type DefaultPhaseConfig = Omit<PhaseConfig, "id">;
const DEFAULT_PHASES: DefaultPhaseConfig[] = [
	{
		label: "Team Time",
		length: 10,
	},
	{
		label: "Action Time",
		length: 15,
	},
	{
		label: "Diplomacy Time",
		length: 10,
	},
	{
		label: "Breaking News",
		length: 10,
	},
	{
		label: "End of Turn",
		length: null,
	},
];

export class SpectrumServer extends EventEmitter {
	constructor(private game: SavedGame) {
		super();
	}

	private static createPhase(phase: DefaultPhaseConfig): PhaseConfig {
		return {
			id: uuid(),
			label: phase.label,
			length: phase.length ? phase.length * MINUTES : null,
		};
	}

	private static createTurn(label: number): [TurnConfig, PhaseConfig[]] {
		let phases: PhaseConfig[] = [];
		for (let dp of DEFAULT_PHASES) {
			phases.push(this.createPhase(dp));
		}

		return [
			{
				id: uuid(),
				label,
				phases: phases.map((p) => p.id),
			},
			phases,
		];
	}

	public static createGame(turns: number): SavedGame {
		let game: SavedGame = {
			currentTurn: null,
			currentPhase: null,
			turnOrder: [],
			phases: {},
			turns: {},
			terror: 1,
			paused: false,
			over: false,
		};

		for (let i = 1; i <= turns; i++) {
			let [turn, phases] = this.createTurn(i);
			let id = turn.id;
			game.turnOrder.push(id);
			game.turns[id] = turn;
			for (let phase of phases) {
				game.phases[phase.id] = phase;
			}
		}

		return game;
	}

	public getSaveGame(): SavedGame {
		return this.game;
	}

	private createTimerStatus(): TimerStatus {
		let game = this.game;

		if (game.paused) {
			return {
				state: "paused",
				timeLeft: game.paused.timeLeft,
			};
		} else if (!game.currentPhase || !game.currentPhase.length) {
			return { state: "hidden" };
		}
		return {
			state: "running",
			endTime: game.currentPhase.ends,
		};
	}

	public emitHeartbeat(): void {
		let game = this.game;

		let turn = game.turns[game.currentTurn || ""];
		let phaseLabel = "";
		let phase = game.currentPhase;
		if (phase) {
			phaseLabel = game.phases[phase.id].label;
		}
		let beat: HeartbeatEvent = {
			turn: turn ? turn.label : 0,
			phase: phaseLabel,
			timer: this.createTimerStatus(),
			terror: game.terror,
		};
		this.emit("heartbeat", beat);
	}

	public getGamePhases(): APIPhase[] {
		return _.map(this.game.phases, (p) => _.pick(p, "id", "label"));
	}

	private nextTurn(): void {
		let game = this.game;
		if (game.over) return;
		let pos = game.turnOrder.indexOf(game.currentTurn || "FIRST TURN") + 1;

		if (pos >= game.turnOrder.length) {
			this.emit("gameOver");
			this.game.over = true;
			return;
		}

		game.currentTurn = game.turnOrder[pos];
		this.emit("turnChange", game.currentTurn);
	}

	private nextPhase(): void {
		let game = this.game;
		if (game.over) return;
		let turn = game.turns[game.currentTurn!];
		if (!turn) {
			throw new Error("No turn?");
		}
		let lastPhase = "FIRST PHASE";
		if (game.currentPhase) {
			lastPhase = game.currentPhase.id;
		}

		let pos = turn.phases.indexOf(lastPhase || "FIRST PHASE") + 1;
		if (pos >= turn.phases.length) {
			this.nextTurn();
			return this.nextPhase();
		}
		let id = turn.phases[pos];
		let { length } = game.phases[id];
		let now = Date.now();

		game.currentPhase = {
			id,
			length,
			started: now,
			ends: length ? now + length : Infinity,
		};
		this.emit("phaseChange", game.currentPhase);

		if (game.paused) {
			game.paused.timeLeft = length ? length : -1;
		}
	}

	public startGame(): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (game.currentPhase) {
			throw new Error("Game already started?");
		}
		this.nextTurn();
		this.nextPhase();
		this.emitHeartbeat();
	}

	public pause(): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		} else if (game.paused) {
			throw new Error("Game already paused?");
		}
		let timeLeft = -1;
		if (game.currentPhase.length != null) {
			timeLeft = game.currentPhase.ends - Date.now();
		}
		game.paused = {
			timeLeft,
		};
		this.emitHeartbeat();
	}

	public unpause(): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		} else if (!game.paused) {
			throw new Error("Game not paused?");
		}
		let { timeLeft } = game.paused;
		if (timeLeft != -1 && game.currentPhase.length != null) {
			let now = Date.now();
			game.currentPhase.started =
				now - (game.currentPhase.length - timeLeft);
			game.currentPhase.ends = now + timeLeft;
		}
		game.paused = false;
		this.tick();
		this.emitHeartbeat();
	}

	public tick() {
		let game = this.game;
		if (game.over || game.paused || !game.currentPhase) {
			return;
		}
		let now = Date.now();
		let phase = game.currentPhase;
		if (phase.ends < now) {
			this.nextPhase();
			this.emitHeartbeat();
		}
	}

	public setTerror(terror: number): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		} else if (terror < 1 || terror > 250) {
			throw new Error("Invalid terror!");
		}

		game.terror = terror;
		this.emitHeartbeat();
		if (terror == 250) {
			this.emit("gameOver");
			game.over = true;
		}
	}

	public addTerror(amount: number): void {
		this.setTerror(this.game.terror + amount);
	}

	public newPhase(
		turnID: string,
		phaseConfig: DefaultPhaseConfig,
	): PhaseConfig {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		}
		let turn = game.turns[turnID];
		if (!turn) {
			throw new Error("Invalid turn!");
		}
		let phase = SpectrumServer.createPhase(phaseConfig);
		game.phases[phase.id] = phase;
		turn.phases.push(phase.id);
		return phase;
	}

	public editPhase(
		phaseID: string,
		phaseConfig: DefaultPhaseConfig,
	): PhaseConfig {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		}
		let phase = game.phases[phaseID];
		if (!phase) {
			throw new Error("Invalid phase!");
		}
		phase.label = phaseConfig.label;
		phase.length = phaseConfig.length ? phaseConfig.length * MINUTES : null;
		if (
			game.currentPhase &&
			game.currentPhase.id == phase.id &&
			game.currentPhase.length != phase.length
		) {
			let cp = game.currentPhase;
			if (!phase.length) {
				cp.ends = Infinity;
			} else if (!cp.length) {
				cp.ends = cp.started + phase.length;
			} else {
				cp.ends += phase.length - cp.length;
			}
			cp.length = phase.length;
			// Update the timer on the client
			this.emitHeartbeat();
			// Check to see if we've just made the current phase so short it
			//  should end immediately.
			// This may emit another heartbeat but I don't care right now
			this.tick();
		}
		return phase;
	}

	public reorderTurnPhases(turnID: string, phases: string[]): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		}
		let turn = game.turns[turnID];
		if (!turn) {
			throw new Error("Invalid turn!");
		}
		turn.phases = phases;
	}

	public newTurn(): [TurnConfig, PhaseConfig[]] {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		}
		let [turn, phases] = SpectrumServer.createTurn(
			game.turnOrder.length + 1,
		);
		let id = turn.id;
		game.turnOrder.push(id);
		game.turns[id] = turn;
		for (let phase of phases) {
			game.phases[phase.id] = phase;
		}
		return [turn, phases];
	}

	public advanceTurn(): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		}
		this.nextTurn();
		this.emitHeartbeat();
	}

	public setTurn(turnID: string): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		} else if (!(turnID in game.turns)) {
			throw new Error("Invalid turn!");
		}

		// Restart the turn
		if (turnID == game.currentTurn) {
			game.currentPhase = null;
		} else {
			game.currentTurn = turnID;
		}
		this.nextPhase();
	}

	public advancePhase(): void {
		let game = this.game;
		if (game.over) {
			throw new Error("Game over man, game over!");
		} else if (!game.currentPhase) {
			throw new Error("Game not running?");
		}
		this.nextPhase();
	}
}
