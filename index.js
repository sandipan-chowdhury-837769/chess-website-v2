let board = null;
let game = null;

try {
    game = new Chess();
} catch (e) {
    console.error("Failed to initialize chess.js. Ensure your local files are correctly loaded.");
}

let moveHistoryFEN = [];
let playerColor = 'w';
let forceGameOver = false;
let assistRenderId = 0; 
let sourceSquare = null; 
let currentOpponentWinProb = 50.0;

const $status = $('#status');
const $arrowSvg = document.getElementById('arrow-svg');

function createEngine() {
    try {
        return new Worker('stockfish.js');
    } catch(e) {
        console.warn("Stockfish worker failed to load.", e);
        return null;
    }
}

const mainEngine = createEngine();    
const evalWorker = createEngine();    
const assistWorkerPlayer = createEngine();  
const assistWorkerOpponent = createEngine();  

function askEngine(engine, commands) {
    return new Promise((resolve) => {
        if (!engine) { resolve([]); return; }
        
        let output = [];
        let fallbackTimeout;
        
        const handler = (e) => {
            const line = typeof e.data === 'string' ? e.data : '';
            if (line) output.push(line);
            if (line.startsWith('bestmove')) {
                engine.removeEventListener('message', handler);
                clearTimeout(fallbackTimeout);
                resolve(output);
            }
        };
        
        engine.addEventListener('message', handler);
        commands.forEach(cmd => engine.postMessage(cmd));

        fallbackTimeout = setTimeout(() => {
            engine.removeEventListener('message', handler);
            resolve(output);
        }, 3000); 
    });
}

function updateProbabilities() {
    if (!game) return;
    const currentFen = game.fen();
    
    if (currentFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        $('#win-prob-white').text(`White: 50.0%`);
        $('#win-prob-black').text(`Black: 50.0%`);
        $('#eval-fill').css('width', `50.0%`);
        currentOpponentWinProb = 50.0;
        return; 
    }

    if (evalWorker) {
        evalWorker.postMessage('stop'); 
        evalWorker.postMessage(`position fen ${currentFen}`);
        evalWorker.postMessage('go depth 12');
    }
}

if (evalWorker) {
    evalWorker.onmessage = function(e) {
        if (!game) return;
        const currentFen = game.fen();
        
        if (currentFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
            $('#win-prob-white').text(`White: 50.0%`);
            $('#win-prob-black').text(`Black: 50.0%`);
            $('#eval-fill').css('width', `50.0%`);
            currentOpponentWinProb = 50.0;
            return; 
        }

        const line = typeof e.data === 'string' ? e.data : '';
        if (line.includes('score cp') || line.includes('score mate')) {
            const match = line.match(/score (cp|mate) (-?\d+)/);
            if (match) {
                const type = match[1];
                let score = parseInt(match[2], 10);
                
                if (game.turn() === 'b') {
                    score = -score;
                }
                
                let wProb, bProb;
                if (type === 'mate') {
                    wProb = score > 0 ? 100 : 0;
                    bProb = score > 0 ? 0 : 100;
                } else {
                    const probW = 1 / (1 + Math.pow(10, -score / 400));
                    wProb = (probW * 100).toFixed(1);
                    bProb = ((1 - probW) * 100).toFixed(1);
                }
                
                $('#win-prob-white').text(`White: ${wProb}%`);
                $('#win-prob-black').text(`Black: ${bProb}%`);
                $('#eval-fill').css('width', `${wProb}%`);

                if (playerColor === 'w') {
                    currentOpponentWinProb = parseFloat(bProb);
                } else {
                    currentOpponentWinProb = parseFloat(wProb);
                }
            }
        }
    };
}

function updateStatus() {
    if (forceGameOver || !game) return; 

    let statusHTML = '';
    if (game.in_checkmate()) statusHTML = 'Game over, ' + (game.turn() === 'w' ? 'Black' : 'White') + ' won.';
    else if (game.in_draw()) statusHTML = 'Game over, drawn position';
    else {
        statusHTML = (game.turn() === 'w' ? 'White to move' : 'Black to move');
        if (game.in_check()) statusHTML += ', ' + (game.turn() === 'w' ? 'White' : 'Black') + ' is in check';
    }
    $status.text(statusHTML);
    updateProbabilities(); 
}

function getSquareCoordinates(square) {
    const file = square.charCodeAt(0) - 97;
    const rank = 8 - parseInt(square[1]);
    const squareSize = 500 / 8; 
    
    let x = (file * squareSize) + (squareSize / 2);
    let y = (rank * squareSize) + (squareSize / 2);

    if (playerColor === 'b') {
        x = 500 - x;
        y = 500 - y;
    }
    return { x, y };
}

function drawArrow(move, color, offsetIndex = 0) {
    if (!move || move.length < 4) return;
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    
    const start = getSquareCoordinates(from);
    const end = getSquareCoordinates(to);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);

    let shift = 0;
    if (offsetIndex > 0) {
        shift = (offsetIndex % 2 === 0 ? -1 : 1) * Math.ceil(offsetIndex / 2) * 6; 
    }

    const offsetX = Math.cos(angle + Math.PI / 2) * shift;
    const offsetY = Math.sin(angle + Math.PI / 2) * shift;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    
    line.setAttribute('x1', start.x + offsetX);
    line.setAttribute('y1', start.y + offsetY);
    line.setAttribute('x2', end.x + offsetX);
    line.setAttribute('y2', end.y + offsetY);
    
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '3'); 
    line.setAttribute('marker-end', `url(#arrowhead-${color})`);
    line.setAttribute('opacity', '0.85');
    $arrowSvg.appendChild(line);
}

function setupSVGDef() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    ['green', 'red'].forEach(color => {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', `arrowhead-${color}`);
        marker.setAttribute('markerWidth', '4');
        marker.setAttribute('markerHeight', '2.8');
        marker.setAttribute('refX', '3');
        marker.setAttribute('refY', '1.4');
        marker.setAttribute('orient', 'auto');
        
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 4 1.4, 0 2.8');
        polygon.setAttribute('fill', color);
        marker.appendChild(polygon);
        defs.appendChild(marker);
    });
    $arrowSvg.appendChild(defs);
}

async function updateAssistance() {
    if (!assistWorkerPlayer || !assistWorkerOpponent || !game) return;

    const renderId = ++assistRenderId;
    $arrowSvg.innerHTML = '';
    setupSVGDef();
    
    assistWorkerPlayer.postMessage('stop');
    assistWorkerOpponent.postMessage('stop');

    if ($('#assistance').val() === 'off' || game.game_over() || forceGameOver) return;
    if (game.turn() !== playerColor) return;

    const currentFen = game.fen();

    const playerCommands = [
        'uci', 'setoption name MultiPV value 2', `position fen ${currentFen}`, 'go depth 10'
    ];
    
    let fenTokens = currentFen.split(' ');
    fenTokens[1] = fenTokens[1] === 'w' ? 'b' : 'w'; 
    fenTokens[3] = '-'; 
    const flippedFen = fenTokens.join(' ');

    const opponentCommands = [
        'uci', 'setoption name MultiPV value 2', `position fen ${flippedFen}`, 'go depth 10'
    ];

    const [playerOutput, opponentOutput] = await Promise.all([
        askEngine(assistWorkerPlayer, playerCommands),
        askEngine(assistWorkerOpponent, opponentCommands)
    ]);
    
    if (renderId !== assistRenderId) return;

    const extractMoves = (output) => {
        const moves = [];
        output.forEach(line => {
            if (line.includes('pv ') && line.includes('multipv')) {
                const parts = line.split(' pv ');
                if (parts[1]) moves.push(parts[1].split(' ')[0]);
            }
        });
        return [...new Set(moves)].slice(0, 2); 
    };

    const tailOverlapCounts = {};

    extractMoves(playerOutput).forEach(move => {
        const fromSq = move.substring(0, 2);
        const count = tailOverlapCounts[fromSq] || 0;
        drawArrow(move, 'green', count);
        tailOverlapCounts[fromSq] = count + 1; 
    });

    extractMoves(opponentOutput).forEach(move => {
        const fromSq = move.substring(0, 2);
        const count = tailOverlapCounts[fromSq] || 0;
        drawArrow(move, 'red', count);
        tailOverlapCounts[fromSq] = count + 1; 
    });
}

function handleGameEnd() {
    $('#review-btn').prop('disabled', false);
    $('#resign-btn').prop('disabled', true);
    $('#draw-btn').prop('disabled', true);
    if (mainEngine) mainEngine.postMessage('stop');
}

async function makeOpponentMove() {
    if (forceGameOver || !game || !mainEngine) return;

    $status.text("Opponent is thinking...");
    const elo = parseInt($('#elo').val());
    const moves = game.moves({ verbose: true });
    
    let randomChance = Math.max(0, (800 - elo) / 700 * 0.6); 
    
    if (Math.random() < randomChance || !mainEngine) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        setTimeout(() => {
            if (!forceGameOver) {
                game.move(randomMove.san);
                board.position(game.fen());
                moveHistoryFEN.push(game.fen());
                updateStatus();
                updateAssistance();
                if (game.game_over()) handleGameEnd();
            }
        }, 600); 
        return;
    }
    
    let skillLevel = Math.max(0, Math.min(20, Math.round((elo - 100) / 170)));
    let searchDepth = Math.max(1, Math.min(20, Math.round(elo / 150)));
    let moveTime = Math.max(300, Math.min(2000, Math.round((elo / 3500) * 2000)));

    const commands = [
        'uci', 
        'setoption name UCI_LimitStrength value true',
        `setoption name UCI_Elo value ${Math.max(100, Math.min(elo, 3500))}`,
        `setoption name Skill Level value ${skillLevel}`,
        `position fen ${game.fen()}`, 
        `go depth ${searchDepth} movetime ${moveTime}`
    ];

    const output = await askEngine(mainEngine, commands);
    const bestMoveLine = output.find(line => line.startsWith('bestmove'));
    const bestMove = bestMoveLine ? bestMoveLine.split(' ')[1] : null;

    if (bestMove && !forceGameOver) {
        game.move({
            from: bestMove.substring(0, 2),
            to: bestMove.substring(2, 4),
            promotion: bestMove.length > 4 ? bestMove.substring(4) : undefined
        });
        
        board.position(game.fen());
        moveHistoryFEN.push(game.fen());
        updateStatus();
        updateAssistance();

        if (game.game_over()) handleGameEnd();
    } else if (moves.length > 0 && !forceGameOver) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        game.move(randomMove.san);
        board.position(game.fen());
        moveHistoryFEN.push(game.fen());
        updateStatus();
        updateAssistance();

        if (game.game_over()) handleGameEnd();
    }
}

$(document).ready(function() {
    if (!game) return;

    $('#board').on('click', '.square-55d63', function() {
        if (game.game_over() || forceGameOver) return;
        if (game.turn() !== playerColor) return;

        const square = $(this).attr('data-square');
        const piece = game.get(square);

        if (sourceSquare === null) {
            if (!piece || piece.color !== playerColor) return;
            sourceSquare = square;
            $('.square-55d63').removeClass('highlight-select');
            $(this).addClass('highlight-select');
        } else {
            if (sourceSquare === square) {
                sourceSquare = null;
                $('.square-55d63').removeClass('highlight-select');
                return;
            }

            if (piece && piece.color === playerColor) {
                sourceSquare = square;
                $('.square-55d63').removeClass('highlight-select');
                $(this).addClass('highlight-select');
                return;
            }

            const moves = game.moves({ verbose: true });
            const isPromo = moves.some(m => m.from === sourceSquare && m.to === square && m.flags.includes('p'));
            
            let promoPiece = 'q';
            if (isPromo) {
                let choice = prompt("Pawn promotion! Enter 'q' (Queen), 'r' (Rook), 'b' (Bishop), or 'n' (Knight):", "q");
                
                while (choice && !['q', 'r', 'b', 'n'].includes(choice.toLowerCase().trim())) {
                    choice = prompt("Invalid choice. Enter 'q' (Queen), 'r' (Rook), 'b' (Bishop), or 'n' (Knight):", "q");
                }

                if (choice) {
                    promoPiece = choice.toLowerCase().trim();
                } else {
                    sourceSquare = null;
                    $('.square-55d63').removeClass('highlight-select');
                    return;
                }
            }

            const move = game.move({
                from: sourceSquare,
                to: square,
                promotion: promoPiece
            });

            if (move === null) {
                sourceSquare = null;
                $('.square-55d63').removeClass('highlight-select');
                return;
            }

            sourceSquare = null;
            $('.square-55d63').removeClass('highlight-select');

            board.position(game.fen());

            $arrowSvg.innerHTML = '';
            setupSVGDef();
            moveHistoryFEN.push(game.fen());
            updateStatus();

            if (game.game_over()) {
                handleGameEnd();
                return;
            }
            
            window.setTimeout(makeOpponentMove, 250);
        }
    });

    $('#start-btn').on('click', () => {
        playerColor = $('#player-color').val();
        sessionStorage.setItem('opponentElo', $('#elo').val()); 
        
        game.reset();
        board.start();
        board.orientation(playerColor === 'w' ? 'white' : 'black');
        
        sourceSquare = null;
        $('.square-55d63').removeClass('highlight-select');
        
        moveHistoryFEN = [game.fen()];
        forceGameOver = false;
        assistRenderId++;

        $('#review-btn').prop('disabled', true);
        $('#resign-btn').prop('disabled', false);
        $('#draw-btn').prop('disabled', false);

        $arrowSvg.innerHTML = '';
        setupSVGDef();
        
        updateStatus();
        updateAssistance();

        if (playerColor === 'b') {
            makeOpponentMove();
        }
    });

    $('#resign-btn').on('click', () => {
        if (game.game_over() || forceGameOver) return;
        forceGameOver = true;
        let winner = playerColor === 'w' ? 'Black' : 'White';
        let result = playerColor === 'w' ? '0-1' : '1-0';
        $status.text(`Game over, you resigned. ${winner} won (${result}).`);
        handleGameEnd();
    });

    $('#draw-btn').on('click', () => {
        if (game.game_over() || forceGameOver) return;
        
        if (currentOpponentWinProb < 30.0) {
            forceGameOver = true;
            $status.text('Game over, drawn by agreement (0.5-0.5).');
            handleGameEnd();
        } else {
            alert("The opponent rejected your draw request because they feel they are winning.");
        }
    });

    $('#review-btn').on('click', () => {
        sessionStorage.setItem('moveHistoryFEN', JSON.stringify(moveHistoryFEN));
        sessionStorage.setItem('fullHistory', JSON.stringify(game.history({ verbose: true })));
        sessionStorage.setItem('playerColor', playerColor);
        window.location.href = 'review.html';
    });

    const config = {
        draggable: false, 
        position: 'start',
        pieceTheme: 'img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', config);
    $(window).resize(board.resize);
    setupSVGDef();
    updateStatus();
});