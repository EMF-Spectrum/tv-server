/**
 * Copyright (C) 2021 EMF Spectrum Team
 *
 * This file is part of The EMF Spectrum TV System.
 *
 * The EMF Spectrum TV System is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * The EMF Spectrum TV System is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with The EMF Spectrum TV System.  If not, see <https://www.gnu.org/licenses/>.
 */

import { EventEmitter } from "node:events";

import { PhaseConstruct, SpectrumGame } from "@/game";
import { PhaseConfig, SavedGame, TurnConfig } from "@web/types/data";

// TODO: If there's more than one admin connected, editing turns etc won't propagate to them
export class SpectrumServer extends EventEmitter {
	constructor(private game: SpectrumGame) {
		super();
		this.game = game;
	}

	public newGame(game: SpectrumGame) {
		this.game = game;
		this.emitHeartbeat();
	}

	public getSaveGame(): SavedGame {
		return this.game;
	}

	public emitHeartbeat(): void {
		this.emit("heartbeat", this.game.getHeartbeat());
	}

	// api method
	public startGame(): void {
		if (this.game.isRunning()) {
			throw new Error("Cannot start already running game");
		} else if (this.game.over) {
			throw new Error("Can't (yet) restart ended game");
		}

		this.game.startGame();
		this.emitTurnChange();
		this.emitHeartbeat();
	}

	// api method
	public pause(): void {
		this.checkGameState();
		let game = this.game;
		if (game.paused) {
			throw new Error("Game is already paused");
		}

		game.pause();

		this.emitHeartbeat();
	}

	// api method
	public unpause(): void {
		this.checkGameState();
		let game = this.game;
		if (!game.paused) {
			throw new Error("Game is not paused");
		}

		game.unpause();

		if (game.isCurrentPhaseOver()) {
			this.nextPhase();
		} else {
			this.emitHeartbeat();
		}
	}

	public tick() {
		let game = this.game;
		if (game.isRunning() && game.isCurrentPhaseOver()) {
			this.nextPhase();
		}
	}

	// api method
	public setTerror(terror: number): void {
		this.checkGameState();
		if (terror < 1 || terror > 250) {
			throw new Error("Invalid terror!");
		}

		let game = this.game;
		game.terror = terror;

		if (terror == 250) {
			this.endGame();
		} else {
			this.emitHeartbeat();
		}
	}

	// api method
	public addTerror(amount: number): void {
		this.setTerror(this.game.terror + amount);
	}

	// api method
	public newPhase(
		turnID: string,
		phaseConfig: PhaseConstruct,
	): [TurnConfig, PhaseConfig] {
		let game = this.game;
		let turn = game.getTurn(turnID);

		let phaseID = game.createPhase(phaseConfig);

		let phase = game.getPhase(phaseID);
		turn.phases.push(phase.id);
		return [turn, phase];
	}

	// api method
	public editPhase(
		phaseID: string,
		phaseConfig: PhaseConstruct,
	): PhaseConfig {
		let game = this.game;

		let currentChanged = game.editPhase(phaseID, phaseConfig);

		if (currentChanged) {
			// It's possible the length of the current phase was reduced so it
			//  is now over, so handle that
			if (game.isCurrentPhaseOver()) {
				this.nextPhase();
			} else {
				this.emitHeartbeat();
			}
		}

		return game.getPhase(phaseID);
	}

	// api method
	public reorderTurnPhases(turnID: string, phases: string[]): TurnConfig {
		let game = this.game;

		let turn = game.getTurn(turnID);

		if (turn.phases.length != phases.length) {
			throw new Error("Provided phases don't match existing phases");
		}
		for (let phase of phases) {
			if (!turn.phases.includes(phase)) {
				throw new Error("Provided phases don't match existing phases");
			}
		}

		turn.phases = phases;

		return turn;
	}

	// api method
	public bumpPhase(phaseID: string, direction: string): TurnConfig {
		if (direction != "up" && direction != "down") {
			throw new Error("Invalid direction?");
		}
		let game = this.game;
		let turn = game.getTurnByPhase(phaseID);

		let idx = turn.phases.indexOf(phaseID);
		if (
			(idx == 0 && direction == "up") ||
			(idx == turn.phases.length - 1 && direction == "down")
		) {
			// Don't move things past their movement point
			return turn;
		}

		turn.phases.splice(idx, 1);

		if (direction == "up") {
			turn.phases.splice(idx - 1, 0, phaseID);
		} else {
			turn.phases.splice(idx + 1, 0, phaseID);
		}

		return turn;
	}

	// api method
	public newTurn(): [TurnConfig, PhaseConfig[]] {
		let game = this.game;

		let turnID = game.createTurn(game.turnOrder.length + 1);

		game.turnOrder.push(turnID);

		let turn = game.getTurn(turnID);
		let phases = turn.phases.map((phaseID) => game.getPhase(phaseID));

		return [turn, phases];
	}

	// api method
	public advanceTurn(): void {
		this.checkGameState();
		this.nextTurn();
	}

	// api method
	public setTurn(turnID: string): void {
		this.checkGameState();
		let game = this.game;

		game.setTurn(turnID);

		this.emitTurnChange();
		this.emitHeartbeat();
	}

	// api method
	public advancePhase(): void {
		this.checkGameState();
		this.nextPhase();
	}

	// api method
	public setPhase(phaseID: string): void {
		this.checkGameState();
		let game = this.game;

		let currentTurn = this.game.getCurrentTurn();
		let targetTurn = this.game.getTurnByPhase(phaseID);

		if (currentTurn.id == targetTurn.id) {
			game.setPhase(phaseID);
		} else {
			game.setTurn(targetTurn.id, phaseID);
		}

		this.emitPhaseChange();
		this.emitHeartbeat();
	}

	// Helper methods

	private endGame() {
		this.game.over = true;
		this.emit("gameOver");
	}

	private checkGameState() {
		if (!this.game.isRunning()) {
			throw new Error("Game is not running");
		}
	}

	private emitTurnChange(): void {
		this.emit("turnChange", this.game.getCurrentTurn().id);
		this.emitPhaseChange();
	}

	private emitPhaseChange(): void {
		this.emit("phaseChange", this.game.getCurrentPhase());
	}

	private nextTurn(): void {
		let game = this.game;
		let nextTurnID = game.getNextTurn();

		if (!nextTurnID) {
			this.endGame();
			return;
		}

		this.game.setTurn(nextTurnID);

		this.emitTurnChange();
		this.emitHeartbeat();
	}

	private nextPhase(): void {
		let game = this.game;

		let nextPhaseID = game.getNextPhase();

		if (!nextPhaseID) {
			this.nextTurn();
			return;
		}

		this.game.setPhase(nextPhaseID);

		this.emitPhaseChange();
		this.emitHeartbeat();
	}
}
