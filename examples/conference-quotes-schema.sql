-- Conference Quotes table for morning briefing
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS conference_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  quote TEXT NOT NULL,
  speaker TEXT NOT NULL,
  talk TEXT NOT NULL,
  conference TEXT NOT NULL  -- e.g. "October 2025", "April 2025"
);

CREATE INDEX IF NOT EXISTS idx_conference_quotes_conference ON conference_quotes(conference);

ALTER TABLE conference_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON conference_quotes FOR ALL USING (true);

-- ============================================================
-- SEED: October 2025 General Conference
-- ============================================================

INSERT INTO conference_quotes (quote, speaker, talk, conference) VALUES

-- Dieter F. Uchtdorf
('Your origin story is divine, and so is your destiny. You left heaven to come here, but heaven has never left you!', 'Dieter F. Uchtdorf', 'Do Your Part with All Your Heart', 'October 2025'),
('Discipleship takes self-discipline. It is not a casual endeavor, and it doesn''t happen by accident.', 'Dieter F. Uchtdorf', 'Do Your Part with All Your Heart', 'October 2025'),
('Because of our beloved Savior, there is no such thing as a no-win scenario.', 'Dieter F. Uchtdorf', 'Do Your Part with All Your Heart', 'October 2025'),

-- Henry B. Eyring
('If we remain faithful in our service, the Lord will refine us. He will strengthen us. And one day we will look back and see that those very trials were evidence of His love.', 'Henry B. Eyring', 'Proved and Strengthened in Christ', 'October 2025'),
('Proving moments are not evidence that the Lord has abandoned you. Rather, they are evidence that He loves you enough to refine and strengthen you.', 'Henry B. Eyring', 'Proved and Strengthened in Christ', 'October 2025'),

-- Gary E. Stevenson
('To be a peacemaker is not to be weak—but to be strong in a way the world may not understand.', 'Gary E. Stevenson', 'Blessed Are the Peacemakers', 'October 2025'),
('Peacemaking requires courage and compromise but does not require sacrifice of principle.', 'Gary E. Stevenson', 'Blessed Are the Peacemakers', 'October 2025'),

-- Patrick Kearon
('All of us can have a new beginning through, and because of, Jesus Christ. Even you.', 'Patrick Kearon', 'Jesus Christ and Your New Beginning', 'October 2025'),
('Jesus gives us as many new beginnings as we need.', 'Patrick Kearon', 'Jesus Christ and Your New Beginning', 'October 2025'),

-- David A. Bednar
('The fundamental purposes for the exercise of agency are to love one another and to choose God.', 'David A. Bednar', 'They Are Their Own Judges', 'October 2025'),
('The Final Judgment is not just an evaluation of a sum total of good and evil acts—what we have done. It is an acknowledgment of the final effect of our acts and thoughts—what we have become.', 'David A. Bednar', 'They Are Their Own Judges', 'October 2025'),

-- Dale G. Renlund
('The more we identify with and remember Jesus Christ, the more we want to be like Him.', 'Dale G. Renlund', 'Taking on the Name of Jesus Christ', 'October 2025'),
('When we take upon ourselves the name of Jesus Christ, we link our name with His. We identify with Him. We gladly become known as Christians.', 'Dale G. Renlund', 'Taking on the Name of Jesus Christ', 'October 2025'),

-- D. Todd Christofferson
('It is only by looking to God that individuals, families, and even nations can flourish.', 'D. Todd Christofferson', 'Look to God and Live', 'October 2025'),
('Jesus Christ loves us and is with us, even though our hearts hurt.', 'D. Todd Christofferson', 'Look to God and Live', 'October 2025'),

-- Jeffrey R. Holland
('God can bless us by whatever method He chooses.', 'Jeffrey R. Holland', 'And Now I See', 'October 2025'),
('The impact of the Book of Mormon in my life is no less miraculous than was the application of spit and dirt placed on the blind man''s eyes.', 'Jeffrey R. Holland', 'And Now I See', 'October 2025'),

-- Neil L. Andersen
('Healing and forgiveness are each found in their fulness in the atoning love of Jesus Christ.', 'Neil L. Andersen', 'The Atoning Love of Jesus Christ', 'October 2025'),
('He has the power to bring beauty from the ashes of your suffering.', 'Neil L. Andersen', 'The Atoning Love of Jesus Christ', 'October 2025'),

-- Gerrit W. Gong
('In His Church and through His ordinances and covenants, we come to each other and to Jesus Christ.', 'Gerrit W. Gong', 'No One Sits Alone', 'October 2025'),
('Living the gospel of Jesus Christ includes making room for all in His restored Church.', 'Gerrit W. Gong', 'No One Sits Alone', 'October 2025'),

-- Ulisses Soares
('Temperance harmonizes and strengthens other Christlike attributes: humility, faith, hope, charity, and the pure love that flows from Him.', 'Ulisses Soares', 'Adorned with the Virtue of Temperance', 'October 2025'),

-- Quentin L. Cook
('We love you; we need you; the Lord needs you.', 'Quentin L. Cook', 'The Lord Is Hastening His Work', 'October 2025'),

-- Ronald A. Rasband
('Happiness in family life is most likely to be achieved when founded upon the teachings of Jesus Christ.', 'Ronald A. Rasband', 'The Family Proclamation—Words from God', 'October 2025'),

-- Dallin H. Oaks
('What those children really want for dinner is time with you.', 'Dallin H. Oaks', 'The Family-Centered Gospel of Jesus Christ', 'October 2025'),
('Exaltation is a family affair. Only through the saving ordinances of the gospel of Jesus Christ can families be exalted.', 'Dallin H. Oaks', 'The Family-Centered Gospel of Jesus Christ', 'October 2025'),

-- J. Anette Dennis
('Charity propels us to bear one another''s burdens rather than heap burdens upon each other.', 'J. Anette Dennis', 'Cheering Each Other On', 'October 2025'),

-- Brik V. Eyre
('I promise you that your Heavenly Father knows you, loves you, and wants to hear from you.', 'Brik V. Eyre', 'Know Who You Really Are', 'October 2025'),

-- James E. Evanson
('Willingness to serve and strengthen others stands as a symbol of one''s readiness to be healed by the redemptive power of the Savior.', 'James E. Evanson', 'Go and Do Likewise', 'October 2025'),

-- Andrea Muñoz Spannaus
('We too can receive a personal testimony of God''s prophets today and open our hearts and minds to His message.', 'Andrea Muñoz Spannaus', 'Prophets of God', 'October 2025'),

-- Carlos A. Godoy
('The joy we feel has little to do with the circumstances of our lives and everything to do with the focus of our lives.', 'Carlos A. Godoy', 'Smiling Faces and Grateful Hearts', 'October 2025');

-- ============================================================
-- After April 2025 conference, just add more rows:
--
-- INSERT INTO conference_quotes (quote, speaker, talk, conference) VALUES
-- ('New quote here', 'Speaker Name', 'Talk Title', 'April 2025');
-- ============================================================
