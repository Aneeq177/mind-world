from services import database


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self.rows, self.user, self.bounds = rows, None, None

    def select(self, _cols):
        return self

    def eq(self, _col, val):
        self.user = val
        return self

    def order(self, _col):
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def execute(self):
        matching = sorted((r for r in self.rows if r["user_id"] == self.user), key=lambda r: r["id"])
        start, end = self.bounds
        # PostgREST never returns more than its max-rows setting per request.
        return _Result(matching[start:min(end + 1, start + database.CONVERSATION_PAGE_SIZE)])


class _FakeSupabase:
    def __init__(self, rows):
        self.rows, self.requests = rows, 0

    def table(self, _name):
        self.requests += 1
        return _Query(self.rows)


def test_reads_every_page_past_the_row_cap(monkeypatch):
    rows = [{"id": f"c{i:05d}", "user_id": "u1"} for i in range(2350)]
    rows += [{"id": "other", "user_id": "u2"}]
    fake = _FakeSupabase(rows)
    monkeypatch.setattr(database, "get_supabase", lambda: fake)

    result = database.get_user_conversations("u1")

    assert len(result) == 2350
    assert len({r["id"] for r in result}) == 2350
    assert fake.requests == 3


def test_exact_page_multiple_stops_on_empty_page(monkeypatch):
    fake = _FakeSupabase([{"id": f"c{i:05d}", "user_id": "u1"} for i in range(database.CONVERSATION_PAGE_SIZE)])
    monkeypatch.setattr(database, "get_supabase", lambda: fake)

    assert len(database.get_user_conversations("u1")) == database.CONVERSATION_PAGE_SIZE
    assert fake.requests == 2
