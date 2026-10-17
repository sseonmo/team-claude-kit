package dev.perfloop.sample.web;

import java.util.List;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    record Row(String name, String category, int amount) {}

    // 화면이 결정론적이어야 스크린샷 관문이 쓸모 있다 — 날짜·난수를 쓰지 않는다
    static final List<Row> ROWS = List.of(
        new Row("커피", "식비", 4500),
        new Row("지하철", "교통", 1550),
        new Row("점심", "식비", 9000),
        new Row("책", "문화", 18000),
        new Row("택시", "교통", 12300),
        new Row("저녁", "식비", 15000));

    @GetMapping("/")
    String home() {
        return "home";
    }

    @GetMapping("/dashboard")
    String dashboard(Model model) {
        model.addAttribute("rows", ROWS);
        model.addAttribute("total", ROWS.stream().mapToInt(Row::amount).sum());
        return "dashboard";
    }

    @GetMapping("/reports")
    String reports(Model model) {
        model.addAttribute("rows", ROWS);
        return "reports";
    }
}
