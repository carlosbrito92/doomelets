/*
    Ponto de entrada fixo do pacote (o KPackage exige contents/ui/main.qml).

    O KWin guarda QML e módulos JS compilados em memória pela URL do arquivo até reiniciar,
    e o pacote instalado sempre fica no mesmo caminho. Por isso o código de verdade vai numa
    pasta com o nome do build (contents/ui/<build>/), e este arquivo — que nunca muda —
    descobre qual carregar pela chave "Build", gravada por scripts/kwin.sh install.
*/
import QtQuick
import org.kde.kwin

Loader {
    readonly property string build: String(KWin.readConfig("Build", ""))
    source: build ? Qt.resolvedUrl(build + "/ui/main.qml") : ""
    Component.onCompleted: if (!build) console.warn("Doomelets: no build configured; install with scripts/kwin.sh install")
}
