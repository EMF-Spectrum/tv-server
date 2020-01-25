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

	// TODO save/load
	let server = new SpectrumServer(SpectrumServer.createGame(7));
	setInterval(() => server.emitHeartbeat(), 1000);
	setInterval(() => server.tick(), 10);

	function forwardEvent(sock: ws, type: string) {
		let handler = (data: unknown) =>
			sock.send(JSON.stringify({ type, data }));
		server.on(type, handler);
		sock.on("close", () => server.off(type, handler));
	}

	app.ws("/socket", (sock) => {
		console.log("Got a websocket connection!");
		forwardEvent(sock, "heartbeat");
		forwardEvent(sock, "gameOver");
		forwardEvent(sock, "phaseChange");
		forwardEvent(sock, "turnChange");
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
		let phase = server.newPhase(
			req.body.turnID,
			_.pick(req.body.phaseConfig, "label", "length"),
		);
		res.status(http.OK).json(phase);
	});
	api.post("/editPhase", (req, res) => {
		let phase = server.editPhase(
			req.body.phaseID,
			_.pick(req.body.phaseConfig, "label", "length"),
		);
		res.status(http.OK).json(phase);
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
	api.post("/setPhase", (req, res) => {
		server.setPhase(req.body.phaseID);
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
