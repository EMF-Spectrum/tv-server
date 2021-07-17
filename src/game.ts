import {
	CurrentPhaseData,
	HeartbeatEvent,
	PhaseConfig,
	SavedGame,
	TimerStatus,
	TurnConfig,
} from "@web/types/data";
import _ from "lodash";
import { v4 as uuid } from "uuid";

const MINUTES = 60 * 1000;

export type PhaseConstruct = Omit<PhaseConfig, "id">;
const DEFAULT_PHASES: PhaseConstruct[] = [
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

export class SpectrumGame implements SavedGame {
	public currentPhase: CurrentPhaseData | null = null;
	public currentTurn: string | null = null;
	public over = false;
	public paused: { timeLeft: DOMTimeStamp } | false = false;
	public phases: { [id: string]: PhaseConfig } = {};
	public terror = 0;
	public turnOrder: string[] = [];
	public turns: { [id: string]: TurnConfig } = {};

	public toJSON(): SavedGame {
		return this;
	}
	public fromJSON(data: SavedGame) {
		this.currentPhase = data.currentPhase;
		this.currentTurn = data.currentTurn;
		this.over = data.over;
		this.paused = data.paused;
		this.phases = data.phases;
		this.terror = data.terror;
		this.turnOrder = data.turnOrder;
		this.turns = data.turns;
	}

	constructor(numTurns: number) {
		for (let i = 1; i <= numTurns; i++) {
			this.turnOrder.push(this.createTurn(i));
		}
	}

	public createTurn(label: number): string {
		let turn: TurnConfig = {
			id: uuid(),
			label,
			phases: this.createDefaultPhases(),
		};
		this.turns[turn.id] = turn;
		return turn.id;
	}

	public createPhase(data: PhaseConstruct): string {
		let phase: PhaseConfig = {
			id: uuid(),
			label: data.label,
			length: data.length ? data.length * MINUTES : null,
		};

		this.phases[phase.id] = phase;
		return phase.id;
	}

	private createDefaultPhases(): string[] {
		return DEFAULT_PHASES.map(this.createPhase, this);
	}

	public isRunning(): boolean {
		return (
			this.currentPhase != null && this.currentTurn != null && !this.over
		);
	}

	public isCurrentPhaseOver(): boolean {
		if (this.paused) {
			return false;
		}
		let currentPhase = this.getCurrentPhase();
		return currentPhase.ends < Date.now();
	}

	public getHeartbeat(): HeartbeatEvent {
		if (!this.isRunning()) {
			return {
				turn: 0,
				phase: "",
				timer: { state: "hidden" },
				terror: 0,
			};
		}

		let currentTurn = this.getCurrentTurn();
		let currentPhase = this.getCurrentPhase();

		let timer: TimerStatus;
		if (this.paused) {
			timer = {
				state: "paused",
				timeLeft: this.paused.timeLeft,
			};
		} else if (currentPhase.length == null) {
			timer = { state: "hidden" };
		} else {
			timer = {
				state: "running",
				endTime: currentPhase.ends,
			};
		}

		return {
			turn: currentTurn.label,
			phase: currentPhase.label,
			timer: timer,
			terror: this.terror,
		};
	}

	public startGame(): void {
		this.terror = 1;
		this.setTurn(this.turnOrder[0]);
	}

	public getTurn(turnID: string): TurnConfig {
		let turn = this.turns[turnID];
		if (!turn) {
			throw new Error(`Unknown turn ${turnID}`);
		}
		return turn;
	}

	public getPhase(phaseID: string): PhaseConfig {
		let phase = this.phases[phaseID];
		if (!phase) {
			throw new Error(`Unknown phase ${phaseID}`);
		}
		return phase;
	}

	public getTurnByPhase(phaseID: string): TurnConfig {
		let turn = _.find(this.turns, (turn) => turn.phases.includes(phaseID));
		if (!turn) {
			throw new Error(`Phase ${phaseID} is not in a turn`);
		}
		return turn;
	}

	public getCurrentTurn(): TurnConfig {
		if (!this.currentTurn) {
			throw new Error("No current turn");
		}
		let turn = this.turns[this.currentTurn];
		if (!turn) {
			throw new Error("Current turn is missing");
		}
		return turn;
	}

	public getCurrentPhase(): CurrentPhaseData {
		if (!this.currentPhase) {
			throw new Error("No current phase");
		}
		return this.currentPhase;
	}

	public getNextTurn(): string | false {
		if (!this.currentTurn) {
			return this.turnOrder[0];
		}
		return (
			this.turnOrder[this.turnOrder.indexOf(this.currentTurn) + 1] ||
			false
		);
	}

	public getNextPhase(): string | false {
		let phaseID = this.getCurrentPhase().id;
		let turn = this.getCurrentTurn();
		return turn.phases[turn.phases.indexOf(phaseID) + 1] || false;
	}

	public pause(): void {
		if (this.paused) {
			return;
		}
		let timeLeft = -1;
		let currentPhase = this.getCurrentPhase();
		if (currentPhase.length != null) {
			timeLeft = currentPhase.ends - Date.now();
		}
		this.paused = { timeLeft };
	}

	public unpause(): void {
		if (!this.paused) {
			return;
		}
		let { timeLeft } = this.paused;
		this.paused = false;
		if (timeLeft == -1) {
			return;
		}
		let currentPhase = this.getCurrentPhase();
		if (currentPhase.length == null) {
			return;
		}
		let now = Date.now();
		// TODO: Figure out a good explanation as to why we adjust the started
		//       variable other than "it works I guess shrug emoji"
		currentPhase.started = now - (currentPhase.length - timeLeft);
		currentPhase.ends = now + timeLeft;
	}

	public setTurn(turnID: string, phaseID?: string): void {
		let turn = this.getTurn(turnID);
		this.currentTurn = turn.id;
		if (!phaseID) {
			phaseID = turn.phases[0];
		} else {
			// validation check
			if (!turn.phases.includes(phaseID)) {
				throw new Error(`Phase ${phaseID} is not in turn ${turnID}`);
			}
		}
		this.setPhase(phaseID);
	}

	public setPhase(phaseID: string): void {
		let phase = this.getPhase(phaseID);
		let now = Date.now();

		this.currentPhase = {
			...phase,
			started: now,
			ends: phase.length ? now + phase.length : Infinity,
		};

		if (this.paused) {
			this.paused.timeLeft = phase.length ? phase.length : -1;
		}
	}

	/**
	 * Updates a phase and if necessary updates the current phase & pause state
	 * to reflect the new data
	 * @returns True if the current phase was modified
	 */
	public editPhase(phaseID: string, data: PhaseConstruct): boolean {
		let phase = this.getPhase(phaseID);
		phase.label = data.label;
		phase.length = data.length;

		let currentPhase = this.currentPhase;

		if (!currentPhase || currentPhase.id != phase.id) {
			return false;
		}

		currentPhase.label = phase.label;

		if (currentPhase.length == phase.length) {
			// Don't need to do any calculations if the lengths are the same
			return true;
		}

		// If the game is paused we need to pretend it isn't so we can ensure
		//  everything is correct when it's actually unpaused for real
		let isPaused = !!this.paused;
		if (isPaused) {
			this.unpause();
		}

		if (phase.length == null) {
			currentPhase.ends = Infinity;
		} else {
			currentPhase.ends = currentPhase.started + phase.length;
		}

		if (isPaused) {
			this.pause();
		}

		return true;
	}
}
