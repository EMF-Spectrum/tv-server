/**
 * Copyright (C) 2019 EMF Spectrum Team
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

import util from "node:util";

import express from "express";
import expressWS from "express-ws";
import http from "http-status-codes";
import _ from "lodash";
import ws from "ws";

import { SpectrumGame } from "@/game";
import { SpectrumServer } from "@/game-server";
import { SocketEvents } from "@web/types/data";

const NUM_TURNS = 7;

const EVENTS_TO_FORWARD: (keyof SocketEvents)[] = [
	"gameOver",
	"heartbeat",
	"phaseChange",
	"phaseEdit",
	"turnChange",
	"turnEdit",
	"turnOrderEdit",
];

function main() {
	let ews = expressWS(express());
	let app = ews.app;

	// TODO save/load
	let server = new SpectrumServer(new SpectrumGame(NUM_TURNS));
	setInterval(() => server.emitHeartbeat(), 1000);
	setInterval(() => server.tick(), 10);

	function forwardEvent(sock: ws, type: keyof SocketEvents) {
		let handler = (data: unknown) =>
			sock.send(JSON.stringify({ type, data }));
		server.on(type, handler);
		sock.on("close", () => server.off(type, handler));
	}

	app.ws("/socket", (sock) => {
		console.log("Got a websocket connection!");
		for (let event of EVENTS_TO_FORWARD) {
			forwardEvent(sock, event);
		}
		server.emitHeartbeat();
	});

	app.get("/", (req, res) => {
		res.send("hewwo");
	});

	let api = express.Router();
	api.use(express.json());
	app.use("/api", api);

	// Fuck your CRUD
	api.post("/getSaveGame", (req, res) => {
		res.status(http.OK).json(server.getSaveGame());
	});
	api.post("/startGame", (req, res) => {
		server.startGame();
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/pause", (req, res) => {
		server.pause();
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/unpause", (req, res) => {
		server.unpause();
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/setTerror", (req, res) => {
		server.setTerror(req.body.amount);
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/addTerror", (req, res) => {
		server.addTerror(req.body.amount);
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/newPhase", (req, res) => {
		let turnID = req.body.turnID;
		if (!_.isString(turnID) || turnID == "__proto__") {
			res.status(400).json({ error: "Invalid turnID" });
			return;
		}
		let phaseConfig = req.body.phaseConfig;
		if (!_.isPlainObject(phaseConfig)) {
			res.status(400).json({ error: "Invalid phaseConfig" });
			return;
		}
		let label = phaseConfig.label;
		if (!_.isString(label) || label == "") {
			res.status(400).json({ error: "Invalid phaseConfig.label" });
			return;
		}
		let length = phaseConfig.length;
		if (!(length === null || (_.isNumber(length) && length > 0))) {
			res.status(400).json({ error: "Invalid phaseConfig.length" });
			return;
		}

		let [turn, phase] = server.newPhase(turnID, { label, length });
		res.status(http.OK).json({ turn, phase });
	});
	api.post("/editPhase", (req, res) => {
		let phaseID = req.body.phaseID;
		if (!_.isString(phaseID) || phaseID == "__proto__") {
			res.status(400).json({ error: "Invalid phaseID" });
			return;
		}
		let phaseConfig = req.body.phaseConfig;
		if (!_.isPlainObject(phaseConfig)) {
			res.status(400).json({ error: "Invalid phaseConfig" });
			return;
		}
		let label = phaseConfig.label;
		if (!_.isString(label) || label == "") {
			res.status(400).json({ error: "Invalid phaseConfig.label" });
			return;
		}
		let length = phaseConfig.length;
		if (!(length === null || (_.isNumber(length) && length > 0))) {
			console.error("fucky length", length);
			res.status(400).json({ error: "Invalid phaseConfig.length" });
			return;
		}

		let phase = server.editPhase(phaseID, { label, length });
		res.status(http.OK).json(phase);
	});
	api.post("/reorderTurnPhases", (req, res) => {
		let turnID = req.body.turnID;
		if (!_.isString(turnID) || turnID == "__proto__") {
			res.status(400).json({ error: "Invalid turnID" });
			return;
		}
		let phases = req.body.phases;
		if (!_.isArray(phases) || phases.length > 50) {
			res.status(400).json({ error: "Invalid phases" });
			return;
		}
		let turn = server.reorderTurnPhases(turnID, phases.map(_.toString));
		res.status(http.OK).json(turn);
	});
	api.post("/bumpPhase", (req, res) => {
		let phaseID = req.body.phaseID;
		if (!_.isString(phaseID) || phaseID == "__proto__") {
			res.status(400).json({ error: "Invalid phaseID" });
			return;
		}
		let direction = req.body.direction;
		if (
			!_.isString(direction) ||
			(direction != "up" && direction != "down")
		) {
			res.status(400).json({ error: "Invalid direction" });
			return;
		}
		let turn = server.bumpPhase(phaseID, direction);
		res.status(http.OK).json(turn);
	});
	api.post("/newTurn", (req, res) => {
		let [turn, phases] = server.newTurn();
		res.status(http.OK).json({ turn, phases });
	});
	api.post("/advanceTurn", (req, res) => {
		server.advanceTurn();
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/advancePhase", (req, res) => {
		server.advancePhase();
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/setPhase", (req, res) => {
		server.setPhase(req.body.phaseID);
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/newGame", (req, res) => {
		server.newGame(new SpectrumGame(NUM_TURNS));
		res.sendStatus(http.NO_CONTENT);
	});

	app.use(((err, req, res, _next) => {
		let errData;
		if (err instanceof Error) {
			errData = {
				error: err.message,
				stack: err.stack,
			};
		} else if (_.isObject(err)) {
			errData = {
				error: util.inspect(err),
			};
		} else {
			errData = {
				error: err + "",
			};
		}

		console.error("Request %s failed:", req, err);

		res.status(http.INTERNAL_SERVER_ERROR).json(errData);
	}) as express.ErrorRequestHandler);

	console.log("Listening at localhost:8081");
	app.listen(8081);
}

main();
