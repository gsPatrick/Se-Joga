// src/poker/poker-hand-evaluator.ts
import { Hand } from 'pokersolver'; // Import the pokersolver library

export function evaluateHand(hand: string[]): any {
    try {
        // Use pokersolver to parse the hand (expects array of card strings like 'As', 'Kh', 'Qd', etc.)
        const pokersolverHand = Hand.solve(hand.map(card => {
            const rank = card.slice(0, card.length - 1).toUpperCase();
            const suit = card.slice(-1).toLowerCase();
            return rank + suit;
        }));

        // Return relevant information from pokersolver's evaluated hand
        return {
            rank: pokersolverHand.rank, // Numerical rank of the hand (lower is better, 1 is Royal Flush)
            handName: pokersolverHand.name, // Human-readable name of the hand (e.g., "Full House", "Flush")
            cards: pokersolverHand.cards, // Array of Card objects in the hand
            // ... you can add more properties from pokersolverHand if needed
        };
    } catch (error) {
        console.error("Erro ao avaliar a mão de poker:", error);
        return {
            rank: -1, // Indicate error with a rank of -1
            handName: "Erro na Avaliação",
            error: (error as Error).message,
        };
    }
}