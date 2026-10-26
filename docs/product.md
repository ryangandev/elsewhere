# Product

This is the behavior contract for Elsewhere.
Code, content, and design decisions should trace back to a section here.
Confirmed with Ryan on 2026-10-26.

## Positioning

Elsewhere helps a curious person understand a place in a few minutes, on the map, starting from their own question.
Each answer leads naturally to a connected question somewhere else in the world.

One line: **Start with a question. See the answer on the map. Follow it somewhere new.**

## Who it is for

Curious adults who run into a "why" while reading news, watching videos, traveling, or talking with friends.
Examples: "Why is Singapore so rich?", "Why does Chile look like that?", "Why do so many ships pass through Turkey?"
They want a real answer quickly, not a course and not a 10,000-word encyclopedia article.

Not the target: students following a curriculum, trip planners who need city-level detail, or people who want live news.

## Main selling point

The map explains the answer.
Every answer comes with a map scene: the camera moves, relevant countries and places light up, and routes or regions show the mechanism.
This is the difference from the alternatives:

- ChatGPT can answer, but as a wall of text with no spatial context and no path onward.
- Wikipedia is organized by topic, is long, and assumes you already know what to look up.
- Google Earth shows places, but has no story.

## Core loop

1. **Arrive with a question**, or pick one of a few suggested starting questions.
2. **Read a short, sourced answer** while the globe shows the geography behind it.
3. **Get one or two doors onward**: a deeper question about the same place, and a connected question elsewhere.
4. Repeat, with the globe always present as home.

## Questions people don't know to ask

A person's questions are limited by what they have already encountered.
Elsewhere offers a small amount of extra direction, without flooding the screen.

- Every country overview leads with a few starter questions chosen to be surprising or clarifying, not exhaustive.
- Every answer ends with at most three next questions: at least one about the same place and one connection elsewhere.
- The home screen suggests a few starting questions next to the question input.
- No feeds, infinite lists, or notification-style prompts.
  At any moment the reader sees a handful of suggestions, never a catalog.

## Content

Content is AI-assisted and must be sourced.

- Answers are generated offline in a structured format, reviewed, and shipped as static content.
- Every answer cites real sources that a reader can open.
  A claim without a source does not ship.
- Places and routes on the map come from geographic datasets, not from model-written coordinates.
- The interface states that content is AI-assisted and shows sources with every answer.
- Coverage grows from a reviewed pilot batch to all countries, not all at once.

Map identities follow Natural Earth's countries and territories.
Names and boundaries are for exploration and do not endorse territorial claims.
Routes are illustrative.

## Language

The product supports English and Simplified Chinese, chosen by locale.
**Build in English first.**
Chinese is added later as a full-parity edition, not a summary, so that development does not maintain two languages while the product is still changing.
Until then the interface and content are English only.

## Stages

**Stage 1: portfolio (current).**
A polished, public, no-account experience that shows the idea working end to end.
Static content, local bookmarks, no backend.

**Stage 2: product.**
Only after Stage 1 feels right.
Likely additions: live answers for questions outside the content bank, accounts and sync, Chinese edition, analytics.
Stage 1 architecture must make these additions possible without a rewrite.

## Out of scope for now

- Quizzes, scores, streaks, social features.
- City-level exploration and heavy GIS tooling.
- Live news or live statistics.
- Accounts, sync, and analytics (Stage 2).
- Chinese edition (later, see [Language](#language)).
