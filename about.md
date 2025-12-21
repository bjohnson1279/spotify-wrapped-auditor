From The Author
12/21/2025

This project started with the intent to prove that while Spotify denies cutting off data for Wrapped at Halloween, they don't give you very long after that.  With the 2025 Wrapped including play counts, I saw an opportunity to use data provided by Spotify and AI to prove my theory.

I downloaded all of my account data from Spotify.  It came in the form of a ZIP file with several JSON files containing all of my historical streaming data.  With this in hand combined with 2025 Wrapper's play counts, it seemed I had enough data to prove my hypothesis.

I started building this utility with Google's Antigravity IDE, relying heavily on Gemini to write the code, and validate the wrapped play count data against the data I downloaded.  In the process of doing so, I determined the cut off date to be November 10.

I started by providing play count data from my top 5 songs, then it was 10, and then 20.  With each step, I was able to watch the AI refine the logic that determines play counts more with each chunk all the way up until I provided 90, at which point it successfully listed songs 91-100 on its own.  It was at that point I decided this was probably something worth sharing, where it could at least be a starting point for others.

This code is unapologetically AI generated, not out of laziness but recognition that AI was going to be much faster and more thorough at applying the necessary logic to create a usable algorithm.  On some level, I view this project as vibe-coded machine learning.  I welcome the opportunity for anybody to build up on what I have already started.  I am curious to see what other people may do with this code base, or anything related as an example of what AI can do with statistical data.  I think we are only scratching the surface of what AI is going to do for data science, and I am very curious to see how it unfolds.