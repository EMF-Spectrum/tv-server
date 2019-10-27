import express from "express";
import expressWS from "express-ws";
import http from "http-status-codes";
import _ from "lodash";
import util from "util";
import ws from "ws";
import { SpectrumServer } from "./game";

function main() {
	let ews = expressWS(express());
	let app = ews.app;
	app.use(((err, req, res, next) => {
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

	// TODO save/load
	let server = new SpectrumServer(SpectrumServer.createGame(7));
	setInterval(() => server.emitHeartbeat(), 1000);
	setInterval(() => server.tick(), 10);

	function forwardEvent(ws: ws, type: string) {
		let handler = (data: any) => ws.send(JSON.stringify({ type, data }));
		server.on(type, handler);
		ws.on("close", () => server.off(type, handler));
	}

	app.ws("/socket", (ws) => {
		console.log("Got a websocket connection!");
		forwardEvent(ws, "heartbeat");
		forwardEvent(ws, "gameOver");
		forwardEvent(ws, "newPhase");
		forwardEvent(ws, "editPhase");
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
		server.setTerror(parseInt(req.body.terror));
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/addTerror", (req, res) => {
		server.setTerror(parseInt(req.body.amount));
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/newPhase", (req, res) => {
		let phase = server.newPhase(
			req.body.turnID,
			_.pick(req.body.phaseConfig, "label", "length"),
		);
		res.status(http.OK).json(phase);
	});
	api.post("/editPhase", (req, res) => {
		server.editPhase(
			req.body.phaseID,
			_.pick(req.body.phaseConfig, "label", "length"),
		);
		res.sendStatus(http.NO_CONTENT);
	});
	api.post("/reorderTurnPhases", (req, res) => {
		server.reorderTurnPhases(
			req.body.turnID,
			_.map(req.body.phases, _.toString),
		);
		res.sendStatus(http.NO_CONTENT);
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

	console.log("Listening at localhost:8081");
	app.listen(8081);
}

main();
