"""Topics and the sources each one draws from.

kind = "news"     reporting from established newsrooms (last ~2 days)
kind = "analysis" long-form explainers, essays and expert blogs (last ~7 days)
kind = "research" new papers, working papers and journal articles (last ~10 days)

Every feed is a public RSS/Atom feed. A feed that fails on a given day is simply skipped.
Edit freely: add a feed by appending (name, url, kind) to a topic.
"""

TOPICS = [
    {
        "id": "econ",
        "name": "Economics & Finance",
        "emoji": "📈",
        "stories": 4,
        "feeds": [
            ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "news"),
            ("The Guardian · Business", "https://www.theguardian.com/business/economics/rss", "news"),
            ("CNBC Economy", "https://www.cnbc.com/id/20910258/device/rss/rss.html", "news"),
            ("NPR Economy", "https://feeds.npr.org/1017/rss.xml", "news"),
            ("Mint · Economy", "https://www.livemint.com/rss/economy", "news"),
            ("The Hindu · Business", "https://www.thehindu.com/business/feeder/default.rss", "news"),
            ("Liberty Street Economics (NY Fed)", "https://libertystreeteconomics.newyorkfed.org/feed/", "analysis"),
            ("CEPR VoxEU", "https://cepr.org/rss/vox-content", "analysis"),
            ("Bruegel", "https://www.bruegel.org/rss.xml", "analysis"),
            ("NBER Working Papers", "https://www.nber.org/rss/new.xml", "research"),
            ("arXiv · General Economics (new)", "https://rss.arxiv.org/rss/econ.GN", "research"),
        ],
    },
    {
        "id": "politics",
        "name": "Politics & World",
        "emoji": "🌍",
        "stories": 4,
        "feeds": [
            ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "news"),
            ("The Guardian · World", "https://www.theguardian.com/world/rss", "news"),
            ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "news"),
            ("NPR Politics", "https://feeds.npr.org/1014/rss.xml", "news"),
            ("The Hindu · National", "https://www.thehindu.com/news/national/feeder/default.rss", "news"),
            ("ProPublica", "https://feeds.propublica.org/propublica/main", "analysis"),
            ("Foreign Policy", "https://foreignpolicy.com/feed/", "analysis"),
            ("War on the Rocks", "https://warontherocks.com/feed/", "analysis"),
        ],
    },
    {
        "id": "psych",
        "name": "Psychology & Mind",
        "emoji": "🧠",
        "stories": 3,
        "feeds": [
            ("PsyPost", "https://www.psypost.org/feed/", "news"),
            ("ScienceDaily · Mind & Brain", "https://www.sciencedaily.com/rss/mind_brain.xml", "news"),
            ("Psyche", "https://psyche.co/feed", "analysis"),
            ("Nature Human Behaviour", "https://www.nature.com/nathumbehav.rss", "research"),
            ("Psychological Science", "https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=pssa&type=etoc&feed=rss", "research"),
        ],
    },
    {
        "id": "scitech",
        "name": "Science & Technology",
        "emoji": "🔬",
        "stories": 4,
        "feeds": [
            ("Quanta Magazine", "https://www.quantamagazine.org/feed/", "analysis"),
            ("Nature News", "https://www.nature.com/nature.rss", "news"),
            ("Science News", "https://www.sciencenews.org/feed", "news"),
            ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "news"),
            ("MIT Technology Review", "https://www.technologyreview.com/feed/", "analysis"),
            ("The Verge", "https://www.theverge.com/rss/index.xml", "news"),
            ("Phys.org", "https://phys.org/rss-feed/", "news"),
            ("arXiv · AI (new)", "https://rss.arxiv.org/rss/cs.AI", "research"),
        ],
    },
    {
        "id": "philo",
        "name": "Philosophy & Ideas",
        "emoji": "🏛️",
        "stories": 2,
        "feeds": [
            ("Aeon", "https://aeon.co/feed.rss", "analysis"),
            ("Daily Nous", "https://dailynous.com/feed/", "news"),
            ("Stanford Encyclopedia (new & revised)", "https://plato.stanford.edu/rss/sep.xml", "research"),
            ("The Philosopher's Magazine", "https://www.philosophersmag.com/feed", "analysis"),
            ("Big Think", "https://bigthink.com/feed/", "analysis"),
        ],
    },
]

MAX_AGE_DAYS = {"news": 2, "analysis": 7, "research": 14}
MAX_PER_FEED = 25   # newest items taken from each feed (arXiv lists hundreds a day)
