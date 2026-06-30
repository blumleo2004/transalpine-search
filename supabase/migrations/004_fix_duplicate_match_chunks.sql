-- Drop the old match_chunks overload that lacks filter parameters.
-- Only the version with filter_speakers / exclude_speakers / filter_year should exist.
DROP FUNCTION IF EXISTS match_chunks(vector, float, int);
