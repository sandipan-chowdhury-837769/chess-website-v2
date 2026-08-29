const moveHistoryFEN = JSON.parse(sessionStorage.getItem('moveHistoryFEN') || "[]");
const fullHistory = JSON.parse(sessionStorage.getItem('fullHistory') || "[]");
const playerColor = sessionStorage.getItem('playerColor') || 'w';
const startOpponentElo = parseInt(sessionStorage.getItem('opponentElo') || "1200", 10);

if (moveHistoryFEN.length === 0) {
    window.location.href = 'index.html';
}

let board = null;
let globalReviewData = [];
let currentReviewIndex = 0;
let staticWhiteElo = 100;
let staticBlackElo = 100;
let staticWhiteAcc = 100;
let staticBlackAcc = 100;

let reviewEngine = null;
try {
    reviewEngine = new Worker('stockfish.js');
} catch(e) {
    console.warn("Stockfish worker failed to load for Match Review.");
}

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
        }, 2000); 
    });
}

function getFormalMoveName(moveObj) {
    const color = moveObj.color === 'w' ? 'White' : 'Black';
    const pieces = { p: '', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
    const piece = pieces[moveObj.piece];
    const square = moveObj.to.toUpperCase();

    if (moveObj.san === 'O-O') return `${color} King (Kingside Castle)`;
    if (moveObj.san === 'O-O-O') return `${color} King (Queenside Castle)`;

    return `${color} ${piece} ${square}`.trim().replace(/\s+/g, ' ');
}

function renderStaticReviewStats() {
    $('.review-stats').html(`
        <div style="display: flex; justify-content: space-evenly; align-items: center; background: #333; padding: 12px; border-radius: 6px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); flex-wrap: wrap; gap: 10px;">
            <div style="text-align: center; min-width: 120px;">
                <h3 style="margin: 0 0 5px 0; color: #fff;">White</h3>
                <p style="margin: 0; font-size: 14px;">Accuracy: <strong style="color:#4CAF50">${staticWhiteAcc.toFixed(1)}%</strong></p>
                <p style="margin: 0; font-size: 14px;">Est. ELO: <strong>${staticWhiteElo}</strong></p>
            </div>
            <div style="text-align: center; min-width: 120px;">
                <h3 style="margin: 0 0 5px 0; color: #fff;">Black</h3>
                <p style="margin: 0; font-size: 14px;">Accuracy: <strong style="color:#4CAF50">${staticBlackAcc.toFixed(1)}%</strong></p>
                <p style="margin: 0; font-size: 14px;">Est. ELO: <strong>${staticBlackElo}</strong></p>
            </div>
        </div>
    `);
}

async function getAbsoluteEval(fen) {
    if (fen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        return 0;
    }

    const output = await askEngine(reviewEngine, [`position fen ${fen}`, 'go movetime 200']);
    let cp = 0;
    
    output.forEach(line => {
        if (line.includes('score cp')) {
            const match = line.match(/score cp (-?\d+)/);
            if (match) cp = parseInt(match[1], 10);
        } else if (line.includes('score mate')) {
            const match = line.match(/score mate (-?\d+)/);
            if (match) cp = parseInt(match[1], 10) > 0 ? 10000 : -10000;
        }
    });
    
    // Convert to absolute white evaluation
    return fen.includes(' w ') ? cp : -cp;
}

async function evaluateEntireMatch() {
    let matchAccuracy = { w: { drop: 0, moves: 0 }, b: { drop: 0, moves: 0 } };
    
    let whiteEloSum = 0, whiteMoves = 0;
    let blackEloSum = 0, blackMoves = 0;

    for (let i = 0; i < globalReviewData.length; i++) {
        let percentage = Math.round(((i + 1) / globalReviewData.length) * 100);
        $('#review-loading p').html(`Analyzing match...<br><b>${percentage}%</b>`);
        
        let data = globalReviewData[i];
        data.eval = await getAbsoluteEval(data.fen);

        if (i > 0) {
            let prevData = globalReviewData[i - 1];
            let playerWhoMoved = prevData.fen.includes(' w ') ? 'w' : 'b';
            
            const getEP = (cp) => 100 / (1 + Math.pow(10, -cp / 400));
            let prevCP = playerWhoMoved === 'w' ? prevData.eval : -prevData.eval;
            let currCP = playerWhoMoved === 'w' ? data.eval : -data.eval;
            let prevEP = getEP(prevCP);
            let currEP = getEP(currCP);
            
            let epLoss = Math.max(0, prevEP - currEP); 

            const getMaterial = (fenStr) => {
                const values = { 'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9 };
                let w = 0, b = 0;
                const boardPart = fenStr.split(' ')[0];
                for (let char of boardPart) {
                    if (values[char.toLowerCase()]) {
                        if (char === char.toUpperCase()) w += values[char.toLowerCase()];
                        else b += values[char.toLowerCase()];
                    }
                }
                return { w, b };
            };

            let prevMat = getMaterial(prevData.fen);
            let currMat = getMaterial(data.fen);
            let isSacrifice = false;
            
            if (playerWhoMoved === 'w' && (currMat.w - currMat.b) < (prevMat.w - prevMat.b)) isSacrifice = true;
            if (playerWhoMoved === 'b' && (currMat.b - currMat.w) < (prevMat.b - prevMat.w)) isSacrifice = true;

            let isPlayer = (playerWhoMoved === playerColor);
            let pSubj = isPlayer ? "You played" : "The opponent played";
            
            let moveEloVal = 100;

            if (isSacrifice && epLoss < 2 && i > 5) { 
                data.category = 'brilliant'; 
                data.explanation = `Brilliant: ${pSubj} a move involving a deliberate piece sacrifice that increases winning probability to maximum amount.`; 
                moveEloVal = 3500;
            } else if (epLoss < 2) { 
                data.category = 'best'; 
                data.explanation = `Best: ${pSubj} the move that increases winning probability to maximum amount.`; 
                moveEloVal = 3200;
            } else if (epLoss < 5) { 
                data.category = 'excellent'; 
                data.explanation = `Excellent: ${pSubj} the move that increases winning probability to reasonable amount.`; 
                moveEloVal = 2600;
            } else if (epLoss < 10) { 
                data.category = 'good'; 
                data.explanation = `Good: ${pSubj} a move that increases winning probability only a little bit.`; 
                moveEloVal = 2000;
            } else if (epLoss < 20) { 
                data.category = 'bad'; 
                data.explanation = `Bad: ${pSubj} the move that decreases winning probability only a little bit.`; 
                moveEloVal = 1200;
            } else if (epLoss < 30) { 
                data.category = 'poor'; 
                data.explanation = `Poor: ${pSubj} the move that decreases winning probability to reasonable amount.`; 
                moveEloVal = 600;
            } else { 
                data.category = 'blunder'; 
                data.explanation = `Blunder: ${pSubj} the move that decreases winning probability to maximum amount.`; 
                moveEloVal = 100;
            }

            matchAccuracy[playerWhoMoved].drop += epLoss;
            matchAccuracy[playerWhoMoved].moves++;

            if (playerWhoMoved === 'w') {
                whiteEloSum += moveEloVal;
                whiteMoves++;
            } else {
                blackEloSum += moveEloVal;
                blackMoves++;
            }
        } else {
            data.category = 'start';
            data.explanation = 'The game begins.';
        }
    }

    staticWhiteAcc = matchAccuracy.w.moves > 0 ? Math.max(10, 100 - (matchAccuracy.w.drop / matchAccuracy.w.moves)) : 100;
    staticBlackAcc = matchAccuracy.b.moves > 0 ? Math.max(10, 100 - (matchAccuracy.b.drop / matchAccuracy.b.moves)) : 100;
    
    if (playerColor === 'w') {
        staticWhiteElo = whiteMoves > 0 ? Math.round(whiteEloSum / whiteMoves) : 1200;
        staticBlackElo = startOpponentElo;
    } else {
        staticBlackElo = blackMoves > 0 ? Math.round(blackEloSum / blackMoves) : 1200;
        staticWhiteElo = startOpponentElo;
    }

    $('#review-loading').addClass('hidden');
    $('#review-play-content').removeClass('hidden');
    
    renderStaticReviewStats();
    applyReviewMoveUI();
}

function applyReviewMoveUI() {
    const data = globalReviewData[currentReviewIndex];
    board.position(data.fen, true); 
    
    $('#review-move-title').text(data.moveName);
    $('#btn-prev-move').prop('disabled', currentReviewIndex === 0);
    $('#btn-next-move').prop('disabled', currentReviewIndex === globalReviewData.length - 1);

    $('#review-move-badge').text(data.category).attr('class', `badge ${data.category}`);
    
    if (currentReviewIndex === globalReviewData.length - 1) {
        $('#review-move-desc').html(data.explanation + "<br><br><strong style='color:#f39c12'>Match Review ends here. No further moves are made.</strong>");
    } else {
        $('#review-move-desc').text(data.explanation);
    }

    // Dynamic Eval Bar Update for Review
    let score = data.eval || 0;
    let wProb, bProb;
    
    if (score >= 9000) {
        wProb = '100.0'; bProb = '0.0';
    } else if (score <= -9000) {
        wProb = '0.0'; bProb = '100.0';
    } else {
        const probW = 1 / (1 + Math.pow(10, -score / 400));
        wProb = (probW * 100).toFixed(1);
        bProb = ((1 - probW) * 100).toFixed(1);
    }
    
    $('#win-prob-white').text(`White: ${wProb}%`);
    $('#win-prob-black').text(`Black: ${bProb}%`);
    $('#eval-fill').css('width', `${wProb}%`);
}

$(document).ready(() => {
    const config = {
        draggable: false,
        position: 'start',
        pieceTheme: 'img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', config);
    board.orientation(playerColor === 'w' ? 'white' : 'black');
    $(window).resize(board.resize);

    globalReviewData.push({
        fen: moveHistoryFEN[0],
        moveName: "Start Position",
        category: "start",
        explanation: "The game begins.",
        evaluated: false
    });
    
    for (let i = 0; i < fullHistory.length; i++) {
        globalReviewData.push({
            fen: moveHistoryFEN[i + 1],
            moveName: getFormalMoveName(fullHistory[i]),
            evaluated: false
        });
    }

    currentReviewIndex = globalReviewData.length > 1 ? 1 : 0;
    
    evaluateEntireMatch();
});

$('#btn-next-move').on('click', () => {
    if (currentReviewIndex < globalReviewData.length - 1) {
        currentReviewIndex++;
        applyReviewMoveUI();
    }
});

$('#btn-prev-move').on('click', () => {
    if (currentReviewIndex > 0) {
        currentReviewIndex--;
        applyReviewMoveUI();
    }
});

$('#btn-exit-review').on('click', () => {
    window.location.href = 'index.html';
});